'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { listProjects, listSessions } = require('./sqliteReader');

test('reads Kimaki 0.17.1 project and session schema without writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kimaki-reader-'));
  const dbPath = path.join(root, 'discord-sessions.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE channel_directories (
      channel_id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      created_at DATETIME
    );
    CREATE TABLE thread_sessions (
      thread_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source TEXT NOT NULL,
      last_synced_name TEXT,
      created_at DATETIME
    );
    CREATE TABLE thread_worktrees (
      thread_id TEXT PRIMARY KEY,
      project_directory TEXT NOT NULL
    );
    CREATE TABLE session_events (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    INSERT INTO channel_directories VALUES ('channel-1', 'C:/repo', 'text', '2026-06-18T10:00:00Z');
    INSERT INTO thread_sessions VALUES ('thread-1', 'session-1', 'kimaki', 'Fix tests', '2026-06-18T10:00:00Z');
    INSERT INTO thread_worktrees VALUES ('thread-1', 'C:/repo');
    INSERT INTO session_events VALUES (1, 'session-1', 'thread-1', 1234);
  `);
  db.close();

  assert.deepEqual(listProjects(dbPath), [{
    directory: 'C:/repo',
    channelId: 'channel-1',
    lastActivity: '2026-06-18T10:00:00Z',
  }]);
  assert.deepEqual(listSessions(dbPath, { projectDir: 'C:/repo' }), [{
    threadId: 'thread-1',
    sessionId: 'session-1',
    threadName: 'Fix tests',
    status: 'kimaki',
    project: 'C:/repo',
    createdAt: '2026-06-18T10:00:00Z',
    updatedAt: 1234,
  }]);

  fs.rmSync(root, { recursive: true, force: true });
});
