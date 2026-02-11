import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { TokenService } from "../tokenService";
import { RelayDatabase } from "../database";
import { createSessionRouter } from "../sessionRoutes";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-secret-for-sessions";

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

function mintTestToken(tokenService: TokenService, overrides?: Partial<{ sub: string; github_login: string; client_id: string }>): string {
  return tokenService.mintAccessToken({
    userId: overrides?.sub ?? TEST_USER_ID,
    githubLogin: overrides?.github_login ?? TEST_LOGIN,
    clientType: "mobile",
    clientId: overrides?.client_id ?? TEST_CLIENT_ID,
    scopes: ["read:sessions", "write:sessions"],
  });
}

function createTestApp(db: RelayDatabase, tokenService: TokenService): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", createSessionRouter(db, tokenService));
  return app;
}

// ---------------------------------------------------------------------------
// In-memory database helper
// ---------------------------------------------------------------------------

function createInMemoryDb(): RelayDatabase {
  const relayDb = new RelayDatabase({ dbPath: ":memory:" });
  // Access private db field to set up in-memory DB directly
  const sqliteDb = new Database(":memory:");
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");

  // Create schema
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
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
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT,
      agent_name TEXT,
      prompt TEXT,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);

  // Override getDb to return our in-memory instance
  (relayDb as any).db = sqliteDb;
  return relayDb;
}

/** Seed a user directly in the DB. */
function seedUser(db: RelayDatabase, userId = TEST_USER_ID, login = TEST_LOGIN): void {
  db.getDb()
    .prepare("INSERT OR IGNORE INTO users (id, github_login) VALUES (?, ?)")
    .run(userId, login);
}

/** Seed a session directly in the DB. */
function seedSession(
  db: RelayDatabase,
  overrides?: Partial<{
    id: string;
    user_id: string;
    agent_name: string;
    status: string;
    prompt: string;
    metadata: string;
  }>,
): string {
  const id = overrides?.id ?? `session-${Math.random().toString(36).slice(2, 10)}`;
  const userId = overrides?.user_id ?? TEST_USER_ID;
  seedUser(db, userId);
  db.getDb()
    .prepare(
      "INSERT INTO sessions (id, user_id, agent_name, status, prompt, metadata, started_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .run(
      id,
      userId,
      overrides?.agent_name ?? "test-agent",
      overrides?.status ?? "active",
      overrides?.prompt ?? null,
      overrides?.metadata ?? null,
    );
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Session Routes", () => {
  let tokenService: TokenService;
  let db: RelayDatabase;
  let app: express.Express;
  let token: string;

  beforeEach(() => {
    tokenService = new TokenService(TEST_CONFIG);
    db = createInMemoryDb();
    app = createTestApp(db, tokenService);
    token = mintTestToken(tokenService);
  });

  afterEach(async () => {
    await db.close();
  });

  // ==========================================================================
  // Auth middleware
  // ==========================================================================

  describe("Auth middleware", () => {
    it("rejects requests without Authorization header", async () => {
      const res = await request(app).get("/api/sessions");
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Bearer token required");
    });

    it("rejects requests with invalid token", async () => {
      const res = await request(app)
        .get("/api/sessions")
        .set("Authorization", "Bearer invalid-token");
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid or expired token");
    });

    it("rejects requests with non-Bearer auth scheme", async () => {
      const res = await request(app)
        .get("/api/sessions")
        .set("Authorization", `Basic ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Bearer token required");
    });

    it("rejects requests with token signed by wrong secret", async () => {
      const wrongService = new TokenService({ jwtSecret: "wrong-secret" });
      const badToken = mintTestToken(wrongService);
      const res = await request(app)
        .get("/api/sessions")
        .set("Authorization", `Bearer ${badToken}`);
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // GET /api/sessions
  // ==========================================================================

  describe("GET /api/sessions", () => {
    it("returns empty list when no sessions exist", async () => {
      const res = await request(app)
        .get("/api/sessions")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toEqual([]);
      expect(res.body.total).toBe(0);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
    });

    it("returns sessions for the authenticated user", async () => {
      const sid = seedSession(db);

      const res = await request(app)
        .get("/api/sessions")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].id).toBe(sid);
      expect(res.body.total).toBe(1);
    });

    it("does not return sessions belonging to other users", async () => {
      seedSession(db, { user_id: "github|99999" });

      const res = await request(app)
        .get("/api/sessions")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it("supports status filter", async () => {
      seedSession(db, { status: "active" });
      seedSession(db, { status: "completed" });

      const res = await request(app)
        .get("/api/sessions?status=completed")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].status).toBe("completed");
      expect(res.body.total).toBe(1);
    });

    it("supports pagination with limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        seedSession(db);
      }

      const res = await request(app)
        .get("/api/sessions?limit=2&offset=1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(2);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(1);
      expect(res.body.total).toBe(5);
    });

    it("caps limit at 100", async () => {
      const res = await request(app)
        .get("/api/sessions?limit=200")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
    });

    it("defaults limit to 50 and offset to 0", async () => {
      const res = await request(app)
        .get("/api/sessions")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
    });
  });

  // ==========================================================================
  // GET /api/sessions/:id
  // ==========================================================================

  describe("GET /api/sessions/:id", () => {
    it("returns a specific session", async () => {
      const sid = seedSession(db, { agent_name: "debugger" });

      const res = await request(app)
        .get(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(sid);
      expect(res.body.agent_name).toBe("debugger");
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .get("/api/sessions/nonexistent-id")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Session not found");
    });

    it("returns 404 for session belonging to another user", async () => {
      const sid = seedSession(db, { user_id: "github|99999" });

      const res = await request(app)
        .get(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/sessions
  // ==========================================================================

  describe("POST /api/sessions", () => {
    it("creates a new session", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .set("Authorization", `Bearer ${token}`)
        .send({ agent_name: "code-reviewer", prompt: "Review my PR" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.agent_name).toBe("code-reviewer");
      expect(res.body.prompt).toBe("Review my PR");
      expect(res.body.status).toBe("active");
      expect(res.body.user_id).toBe(TEST_USER_ID);
      expect(res.body.client_id).toBe(TEST_CLIENT_ID);
      expect(res.body.started_at).toBeDefined();
    });

    it("creates user via upsert when user does not exist", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .set("Authorization", `Bearer ${token}`)
        .send({ agent_name: "test-agent" });

      expect(res.status).toBe(201);

      // Verify user was created
      const user = db.getDb().prepare("SELECT * FROM users WHERE id = ?").get(TEST_USER_ID) as any;
      expect(user).toBeDefined();
      expect(user.github_login).toBe(TEST_LOGIN);
    });

    it("stores metadata as JSON", async () => {
      const metadata = { key: "value", nested: { a: 1 } };
      const res = await request(app)
        .post("/api/sessions")
        .set("Authorization", `Bearer ${token}`)
        .send({ agent_name: "test-agent", metadata });

      expect(res.status).toBe(201);
      expect(JSON.parse(res.body.metadata)).toEqual(metadata);
    });

    it("returns 400 when agent_name is missing", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .set("Authorization", `Bearer ${token}`)
        .send({ prompt: "Do something" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("agent_name is required");
    });

    it("allows prompt to be optional", async () => {
      const res = await request(app)
        .post("/api/sessions")
        .set("Authorization", `Bearer ${token}`)
        .send({ agent_name: "test-agent" });

      expect(res.status).toBe(201);
      expect(res.body.prompt).toBeNull();
    });
  });

  // ==========================================================================
  // PUT /api/sessions/:id
  // ==========================================================================

  describe("PUT /api/sessions/:id", () => {
    it("updates session status", async () => {
      const sid = seedSession(db);

      const res = await request(app)
        .put(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "completed" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("completed");
      expect(res.body.completed_at).toBeDefined();
    });

    it("sets completed_at when status is failed", async () => {
      const sid = seedSession(db);

      const res = await request(app)
        .put(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "failed", error: "Something went wrong" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("failed");
      expect(res.body.completed_at).toBeDefined();
      expect(res.body.error).toBe("Something went wrong");
    });

    it("does not set completed_at for non-terminal statuses", async () => {
      const sid = seedSession(db, { status: "pending" });

      const res = await request(app)
        .put(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "active" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("active");
      expect(res.body.completed_at).toBeNull();
    });

    it("updates metadata", async () => {
      const sid = seedSession(db);
      const newMeta = { result: "success", lines: 42 };

      const res = await request(app)
        .put(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ metadata: newMeta });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body.metadata)).toEqual(newMeta);
    });

    it("updates error field", async () => {
      const sid = seedSession(db);

      const res = await request(app)
        .put(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ error: "timeout" });

      expect(res.status).toBe(200);
      expect(res.body.error).toBe("timeout");
    });

    it("returns 400 for invalid status", async () => {
      const sid = seedSession(db);

      const res = await request(app)
        .put(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "invalid-status" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid status");
    });

    it("returns 400 when no valid fields provided", async () => {
      const sid = seedSession(db);

      const res = await request(app)
        .put(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("No valid fields to update");
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .put("/api/sessions/nonexistent-id")
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "completed" });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Session not found");
    });

    it("returns 404 for session belonging to another user", async () => {
      const sid = seedSession(db, { user_id: "github|99999" });

      const res = await request(app)
        .put(`/api/sessions/${sid}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "completed" });

      expect(res.status).toBe(404);
    });
  });
});
