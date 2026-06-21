#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(__dirname, 'repair-consolidation-tags.mjs');
const Database = require('better-sqlite3');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function run(...args) {
  return childProcess.spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function createTestDb() {
  const tmpPath = path.join(os.tmpdir(), `repair-test-${Date.now()}.db`);
  const db = new Database(tmpPath);

  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY, correlation_id TEXT, title TEXT, description TEXT,
      acceptance_criteria_json TEXT, rejection_criteria_json TEXT, status TEXT,
      tags_json TEXT, revision INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT,
      scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS roadmaps (
      id TEXT PRIMARY KEY, goal_id TEXT REFERENCES goals(id), correlation_id TEXT,
      title TEXT, summary TEXT, status TEXT, tags_json TEXT, revision INTEGER DEFAULT 1,
      created_at TEXT, updated_at TEXT, scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS work_points (
      id TEXT PRIMARY KEY, roadmap_id TEXT, title TEXT, tags_json TEXT,
      created_at TEXT, updated_at TEXT, scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY, goal_id TEXT, roadmap_id TEXT, work_point_id TEXT,
      title TEXT, tags_json TEXT, created_at TEXT, updated_at TEXT,
      scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY, plan_id TEXT, work_point_id TEXT, title TEXT,
      tags_json TEXT, created_at TEXT, updated_at TEXT, scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, title TEXT, tags_json TEXT, created_at TEXT, updated_at TEXT,
      scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS review_points (
      id TEXT PRIMARY KEY, title TEXT, tags_json TEXT, created_at TEXT, updated_at TEXT,
      scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS tag_index (
      scope_key TEXT DEFAULT 'default', entity_type TEXT, entity_id TEXT, tag TEXT,
      PRIMARY KEY (scope_key, entity_type, entity_id, tag)
    );
    CREATE TABLE IF NOT EXISTS planning_events (
      event_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, correlation_id TEXT,
      causation_id TEXT, run_id TEXT NOT NULL, stream_id TEXT NOT NULL,
      sequence INTEGER NOT NULL, parent_event_id TEXT, event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL, payload_json TEXT, scope_key TEXT DEFAULT 'default'
    );
  `);

  return { tmpPath, db };
}

function seedTestDb(db) {
  const insert = db.transaction(() => {
    const now = new Date().toISOString();
    const GOAL_ID = 'GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603';
    const ROADMAPS = [
      ['RM-COPILOT-GIT-UI-20260603', 'git-ui'],
      ['RM-WORKTREE-MERGE-CONSISTENCY-20260603', 'worktrees'],
      ['RM-VALIDATION-RECEIPTS-20260603', 'validation'],
      ['RM-HOOKS-AGENT-LANE-ENFORCEMENT-20260603', 'hooks'],
      ['RM-CODEX-PLANNING-BOOTSTRAP-20260603', 'elegy-planning'],
    ];

    db.prepare(
      'INSERT OR REPLACE INTO goals (id, tags_json, status, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      GOAL_ID,
      JSON.stringify(['repo:elegy', 'repo:elegy-copilot']),
      'draft', 1, now, now, 'default',
    );

    for (const [id, tag] of ROADMAPS) {
      db.prepare(
        'INSERT OR REPLACE INTO roadmaps (id, goal_id, tags_json, status, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, GOAL_ID, JSON.stringify([tag]), 'draft', 1, now, now, 'default');
    }

    db.prepare('INSERT OR REPLACE INTO tag_index (scope_key, entity_type, entity_id, tag) VALUES (?, ?, ?, ?)').run(
      'default', 'goal', GOAL_ID, 'repo:elegy',
    );
    db.prepare('INSERT OR REPLACE INTO tag_index (scope_key, entity_type, entity_id, tag) VALUES (?, ?, ?, ?)').run(
      'default', 'goal', GOAL_ID, 'repo:elegy-copilot',
    );
  });

  insert();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('script exits 2 when --db is missing', () => {
  const result = run();
  assert.strictEqual(result.status, 2, `exit code: ${result.status}`);
});

test('dry-run exits 2 with changes', () => {
  const { tmpPath, db } = createTestDb();
  try {
    seedTestDb(db);
    db.close();
    const result = run('--db', tmpPath, '--dry-run');
    assert.strictEqual(result.status, 2, `exit code: ${result.status}`);
    assert.ok(result.stderr.includes('DRY-RUN'), 'expected DRY-RUN output');
    assert.ok(result.stderr.includes('GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603'), 'expected goal in plan');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('apply repairs tags on goal and roadmaps', () => {
  const { tmpPath, db } = createTestDb();
  try {
    seedTestDb(db);
    db.close();

    const result = run('--db', tmpPath);
    assert.strictEqual(result.status, 0, `exit code: ${result.status}, stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('SUCCESS'), 'expected SUCCESS');

    // Read back and verify
    const db2 = new Database(tmpPath, { readonly: true });
    const goal = db2.prepare('SELECT tags_json FROM goals WHERE id = ?').get('GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603');
    const tags = JSON.parse(goal.tags_json);
    assert.ok(tags.includes('repo:elegy'), 'expected repo:elegy');
    assert.ok(tags.includes('source:codex'), 'expected source:codex');
    assert.ok(tags.includes('phase:1'), 'expected phase:1');
    assert.ok(tags.includes('theme:consolidation'), 'expected theme:consolidation on goal');

    const rm1 = db2.prepare('SELECT tags_json FROM roadmaps WHERE id = ?').get('RM-COPILOT-GIT-UI-20260603');
    const rm1Tags = JSON.parse(rm1.tags_json);
    assert.ok(rm1Tags.includes('git-ui'), 'expected original feature tag preserved');
    assert.ok(rm1Tags.includes('repo:elegy'), 'expected repo:elegy on roadmap');

    // Verify tag_index
    const tiRows = db2.prepare('SELECT COUNT(*) AS c FROM tag_index WHERE tag = ?').get('source:codex');
    assert.strictEqual(tiRows.c, 6, 'expected 6 entities with source:codex (goal + 5 roads)');

    // Verify planning_events
    const events = db2.prepare(
      "SELECT COUNT(*) AS c FROM planning_events WHERE event_type = 'tag_repair_direct_sqlite'",
    ).get();
    assert.strictEqual(events.c, 6, 'expected 6 repair events');
    db2.close();
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('idempotency: re-run on repaired DB makes no changes', () => {
  const { tmpPath, db } = createTestDb();
  try {
    seedTestDb(db);
    db.close();

    // First run
    const r1 = run('--db', tmpPath);
    assert.strictEqual(r1.status, 0, `first run exit: ${r1.status}`);

    // Second run
    const r2 = run('--db', tmpPath);
    assert.strictEqual(r2.status, 0, `second run exit: ${r2.status}`);
    assert.ok(
      r2.stderr.includes('No changes needed'),
      `expected 'No changes needed', got: ${r2.stderr}`,
    );
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('idempotencyKey prevents duplicate events', () => {
  const { tmpPath, db } = createTestDb();
  try {
    seedTestDb(db);
    db.close();

    // Run twice
    run('--db', tmpPath);
    run('--db', tmpPath);

    const db2 = new Database(tmpPath, { readonly: true });
    const events = db2.prepare(
      "SELECT COUNT(*) AS c FROM planning_events WHERE event_type = 'tag_repair_direct_sqlite'",
    ).get();
    assert.strictEqual(events.c, 6, 'expected exactly 6 events (not 12) due to idempotencyKey guard');
    db2.close();
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
