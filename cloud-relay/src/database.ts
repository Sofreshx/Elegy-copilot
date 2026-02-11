/**
 * SQLite Database Manager for the Cloud Relay
 *
 * Provides persistent storage using better-sqlite3 with WAL mode.
 * Schema is versioned and auto-migrated on startup.
 */

import Database from "better-sqlite3";
import path from "path";

/** Current schema version — bump when adding migrations */
const CURRENT_SCHEMA_VERSION = 1;

export interface RelayDatabaseOptions {
  /** Path to the .db file. Defaults to ./data/relay.db */
  dbPath?: string;
  /** Enable verbose SQL logging (development only) */
  verbose?: boolean;
}

export class RelayDatabase {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly verbose: boolean;

  constructor(options: RelayDatabaseOptions = {}) {
    this.dbPath = options.dbPath ?? path.join(process.cwd(), "data", "relay.db");
    this.verbose = options.verbose ?? false;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Open the database, enable WAL mode, and run migrations. */
  async initialize(): Promise<void> {
    // Ensure the data directory exists
    const dir = path.dirname(this.dbPath);
    const fs = await import("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath, {
      verbose: this.verbose ? (msg) => console.log(`[SQL] ${msg}`) : undefined,
    });

    // Performance pragmas
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    this.migrate();

    console.log(
      `[Database] Initialized at ${this.dbPath} (schema v${this.getSchemaVersion()}, WAL mode)`
    );
  }

  /** Close the database connection. Safe to call multiple times. */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log("[Database] Connection closed");
    }
  }

  /** Return the underlying better-sqlite3 instance (for use by repositories). */
  getDb(): Database.Database {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  // ---------------------------------------------------------------------------
  // Schema versioning & migrations
  // ---------------------------------------------------------------------------

  private getSchemaVersion(): number {
    const db = this.getDb();

    // Check if schema_version table exists
    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
      )
      .get();

    if (!tableExists) {
      return 0;
    }

    const row = db
      .prepare("SELECT MAX(version) as version FROM schema_version")
      .get() as { version: number | null } | undefined;

    return row?.version ?? 0;
  }

  private setSchemaVersion(version: number): void {
    this.getDb()
      .prepare("INSERT INTO schema_version (version) VALUES (?)")
      .run(version);
  }

  private migrate(): void {
    const currentVersion = this.getSchemaVersion();

    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
      return;
    }

    console.log(
      `[Database] Migrating from v${currentVersion} to v${CURRENT_SCHEMA_VERSION}...`
    );

    const db = this.getDb();

    // Run all migrations inside a single transaction
    const runMigrations = db.transaction(() => {
      if (currentVersion < 1) {
        this.migrateV1();
      }

      // Future migrations:
      // if (currentVersion < 2) { this.migrateV2(); }
    });

    runMigrations();

    console.log(`[Database] Migration complete (now at v${this.getSchemaVersion()})`);
  }

  // ---------------------------------------------------------------------------
  // Migration: v0 → v1  (initial schema)
  // ---------------------------------------------------------------------------

  private migrateV1(): void {
    const db = this.getDb();

    // schema_version
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // users
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        github_login TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        last_seen_at TEXT
      )
    `);

    // sessions
    db.exec(`
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

    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);

    // task_queue
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_queue (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT,
        priority INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        assigned_client_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT,
        completed_at TEXT,
        result TEXT
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_task_queue_user_id ON task_queue(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status)`);

    // push_subscriptions
    db.exec(`
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

    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id)`
    );

    // offline_messages
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

    this.setSchemaVersion(1);
  }
}
