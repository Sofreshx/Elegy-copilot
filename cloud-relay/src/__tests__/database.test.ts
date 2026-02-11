import Database from "better-sqlite3";
import { RelayDatabase } from "../database";
import path from "path";
import fs from "fs";
import os from "os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function freshDbPath(name = "test.db"): string {
  return path.join(tmpDir, name);
}

async function createInitializedDb(
  name = "test.db"
): Promise<RelayDatabase> {
  const db = new RelayDatabase({ dbPath: freshDbPath(name) });
  await db.initialize();
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RelayDatabase", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-db-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. File & lifecycle
  // -------------------------------------------------------------------------

  it("creates the database file on initialize()", async () => {
    const dbPath = freshDbPath();
    const db = new RelayDatabase({ dbPath });
    expect(fs.existsSync(dbPath)).toBe(false);

    await db.initialize();
    expect(fs.existsSync(dbPath)).toBe(true);

    await db.close();
  });

  it("creates the parent directory if it does not exist", async () => {
    const nested = path.join(tmpDir, "sub", "deep", "relay.db");
    const db = new RelayDatabase({ dbPath: nested });
    await db.initialize();

    expect(fs.existsSync(nested)).toBe(true);
    await db.close();
  });

  it("getDb() throws before initialize() is called", () => {
    const db = new RelayDatabase({ dbPath: freshDbPath() });
    expect(() => db.getDb()).toThrow(/not initialized/i);
  });

  it("close() makes getDb() throw again", async () => {
    const db = await createInitializedDb();
    expect(() => db.getDb()).not.toThrow();

    await db.close();
    expect(() => db.getDb()).toThrow(/not initialized/i);
  });

  it("close() is safe to call multiple times", async () => {
    const db = await createInitializedDb();
    await db.close();
    await db.close(); // should not throw
  });

  // -------------------------------------------------------------------------
  // 2. Schema tables
  // -------------------------------------------------------------------------

  it("creates all expected tables after migration", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    const tables = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "offline_messages",
        "push_subscriptions",
        "schema_version",
        "sessions",
        "task_queue",
        "users",
      ])
    );
    expect(tables).toHaveLength(6);

    await db.close();
  });

  it("schema_version is 1 after migration", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    const row = raw
      .prepare("SELECT MAX(version) AS version FROM schema_version")
      .get() as { version: number };

    expect(row.version).toBe(1);
    await db.close();
  });

  // -------------------------------------------------------------------------
  // 3. Pragmas
  // -------------------------------------------------------------------------

  it("enables WAL journal mode", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    const row = raw.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(row.journal_mode).toBe("wal");

    await db.close();
  });

  it("enables foreign keys", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    const row = raw.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    expect(row.foreign_keys).toBe(1);

    await db.close();
  });

  // -------------------------------------------------------------------------
  // 4. Column checks (spot-check users & sessions)
  // -------------------------------------------------------------------------

  it("users table has expected columns", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    const cols = raw
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((c: any) => c.name);

    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "github_login",
        "avatar_url",
        "created_at",
        "last_seen_at",
      ])
    );

    await db.close();
  });

  it("sessions table has expected columns", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    const cols = raw
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((c: any) => c.name);

    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "client_id",
        "agent_name",
        "prompt",
        "status",
        "started_at",
        "completed_at",
        "error",
        "metadata",
        "created_at",
      ])
    );

    await db.close();
  });

  it("offline_messages table has expected columns", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    const cols = raw
      .prepare("PRAGMA table_info(offline_messages)")
      .all()
      .map((c: any) => c.name);

    expect(cols).toEqual(
      expect.arrayContaining([
        "message_id",
        "target_user_id",
        "target_client_id",
        "message_type",
        "payload",
        "enqueued_at",
        "expires_at",
      ])
    );

    await db.close();
  });

  // -------------------------------------------------------------------------
  // 5. Data integrity / CRUD
  // -------------------------------------------------------------------------

  it("can insert and retrieve a user", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    raw
      .prepare(
        "INSERT INTO users (id, github_login, avatar_url) VALUES (?, ?, ?)"
      )
      .run("user-1", "octocat", "https://example.com/avatar.png");

    const user = raw.prepare("SELECT * FROM users WHERE id = ?").get("user-1") as any;

    expect(user).toBeDefined();
    expect(user.id).toBe("user-1");
    expect(user.github_login).toBe("octocat");
    expect(user.avatar_url).toBe("https://example.com/avatar.png");
    expect(user.created_at).toBeTruthy();

    await db.close();
  });

  it("can insert and retrieve a session with FK to user", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    raw
      .prepare("INSERT INTO users (id, github_login) VALUES (?, ?)")
      .run("user-1", "octocat");

    raw
      .prepare(
        "INSERT INTO sessions (id, user_id, agent_name, status) VALUES (?, ?, ?, ?)"
      )
      .run("sess-1", "user-1", "copilot", "active");

    const sess = raw.prepare("SELECT * FROM sessions WHERE id = ?").get("sess-1") as any;

    expect(sess).toBeDefined();
    expect(sess.user_id).toBe("user-1");
    expect(sess.agent_name).toBe("copilot");
    expect(sess.status).toBe("active");

    await db.close();
  });

  it("foreign key constraint rejects session with non-existent user", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    expect(() =>
      raw
        .prepare(
          "INSERT INTO sessions (id, user_id, agent_name) VALUES (?, ?, ?)"
        )
        .run("sess-orphan", "no-such-user", "agent")
    ).toThrow(/FOREIGN KEY/i);

    await db.close();
  });

  it("push_subscriptions unique constraint on (user_id, endpoint)", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    raw
      .prepare("INSERT INTO users (id, github_login) VALUES (?, ?)")
      .run("user-1", "octocat");

    const insert = raw.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?, ?)"
    );

    insert.run("sub-1", "user-1", "https://push.example.com/a", "p256", "auth");

    // Duplicate (user_id, endpoint) should fail
    expect(() =>
      insert.run("sub-2", "user-1", "https://push.example.com/a", "p256-2", "auth-2")
    ).toThrow(/UNIQUE/i);

    // Different endpoint for same user is fine
    expect(() =>
      insert.run("sub-3", "user-1", "https://push.example.com/b", "p256-3", "auth-3")
    ).not.toThrow();

    await db.close();
  });

  // -------------------------------------------------------------------------
  // 6. Indexes
  // -------------------------------------------------------------------------

  it("expected indexes exist on task_queue and sessions", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    const indexes = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
      )
      .all()
      .map((r: any) => r.name);

    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_sessions_user_id",
        "idx_sessions_status",
        "idx_task_queue_user_id",
        "idx_task_queue_status",
        "idx_push_subscriptions_user_id",
        "idx_offline_messages_target_user_id",
      ])
    );

    await db.close();
  });

  // -------------------------------------------------------------------------
  // 7. Re-opening & idempotent migration
  // -------------------------------------------------------------------------

  it("re-opening the same DB file does not duplicate migration", async () => {
    const dbPath = freshDbPath("reopen.db");

    // First open
    const db1 = new RelayDatabase({ dbPath });
    await db1.initialize();
    await db1.close();

    // Second open — migration should be a no-op
    const db2 = new RelayDatabase({ dbPath });
    await db2.initialize();
    const raw = db2.getDb();

    // schema_version should still have exactly one row with version 1
    const rows = raw.prepare("SELECT * FROM schema_version").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);

    // Tables should still be 6
    const tables = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all();
    expect(tables).toHaveLength(6);

    await db2.close();
  });

  // -------------------------------------------------------------------------
  // 8. Concurrent reads (WAL)
  // -------------------------------------------------------------------------

  it("supports concurrent read connections via WAL mode", async () => {
    const dbPath = freshDbPath("wal-concurrent.db");

    const db = new RelayDatabase({ dbPath });
    await db.initialize();

    // Insert a user via the primary connection
    db.getDb()
      .prepare("INSERT INTO users (id, github_login) VALUES (?, ?)")
      .run("user-wal", "waluser");

    // Open a second read-only connection to the same file
    const reader = new Database(dbPath, { readonly: true });
    const user = reader
      .prepare("SELECT * FROM users WHERE id = ?")
      .get("user-wal") as any;

    expect(user).toBeDefined();
    expect(user.github_login).toBe("waluser");

    reader.close();
    await db.close();
  });

  // -------------------------------------------------------------------------
  // 9. task_queue FK and defaults
  // -------------------------------------------------------------------------

  it("task_queue respects FK to users and applies defaults", async () => {
    const db = await createInitializedDb();
    const raw = db.getDb();

    raw
      .prepare("INSERT INTO users (id, github_login) VALUES (?, ?)")
      .run("user-1", "octocat");

    raw
      .prepare(
        "INSERT INTO task_queue (id, user_id, title) VALUES (?, ?, ?)"
      )
      .run("task-1", "user-1", "Do something");

    const task = raw.prepare("SELECT * FROM task_queue WHERE id = ?").get("task-1") as any;

    expect(task.status).toBe("pending");
    expect(task.priority).toBe(1);
    expect(task.created_at).toBeTruthy();

    // FK violation
    expect(() =>
      raw
        .prepare("INSERT INTO task_queue (id, user_id, title) VALUES (?, ?, ?)")
        .run("task-bad", "ghost", "Nope")
    ).toThrow(/FOREIGN KEY/i);

    await db.close();
  });
});
