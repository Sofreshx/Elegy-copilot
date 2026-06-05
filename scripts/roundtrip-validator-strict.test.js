#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const validatorPath = path.resolve(__dirname, 'validate-planning-metadata.js');
const repairPath = path.resolve(__dirname, 'repair-consolidation-tags.mjs');
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

function runValidator(dbPath, extraArgs = []) {
  return childProcess.spawnSync(process.execPath, [validatorPath, '--db', dbPath, ...extraArgs], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function runRepair(dbPath, extraArgs = []) {
  return childProcess.spawnSync(process.execPath, [repairPath, '--db', dbPath, ...extraArgs], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function createTestDb() {
  const tmpPath = path.join(os.tmpdir(), `roundtrip-test-${Date.now()}.db`);
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

function seedUntaggedEntities(db) {
  const now = new Date().toISOString();
  // Use the same IDs the repair script expects, but with empty/feature-only tags
  const GOAL_ID = 'GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603';
  const ROADMAP_IDS = [
    'RM-COPILOT-GIT-UI-20260603',
    'RM-WORKTREE-MERGE-CONSISTENCY-20260603',
    'RM-VALIDATION-RECEIPTS-20260603',
    'RM-HOOKS-AGENT-LANE-ENFORCEMENT-20260603',
    'RM-CODEX-PLANNING-BOOTSTRAP-20260603',
  ];

  const insert = db.transaction(() => {
    // Insert a goal with NO repo tags (feature-only)
    db.prepare(
      'INSERT OR REPLACE INTO goals (id, tags_json, status, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(GOAL_ID, JSON.stringify(['feature:test']), 'draft', 1, now, now, 'default');

    // Insert 5 roadmaps with NO repo tags
    for (const id of ROADMAP_IDS) {
      db.prepare(
        'INSERT OR REPLACE INTO roadmaps (id, goal_id, tags_json, status, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, GOAL_ID, JSON.stringify(['feature:test']), 'draft', 1, now, now, 'default');
    }

    // Add work_points/plans/todos for each roadmap so the validator with --strict
    // does not flag missingWorkItems after repair. Use consistent repo:* tags
    // matching what the repair script will add to avoid inconsistentTags issues.
    const wpIds = [];
    for (let i = 0; i < ROADMAP_IDS.length; i++) {
      const wpId = `WP-CONSOLIDATION-TEST-${i}`;
      db.prepare(
        'INSERT OR REPLACE INTO work_points (id, roadmap_id, title, tags_json, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(wpId, ROADMAP_IDS[i], `Test work point ${i}`, JSON.stringify(['repo:74af0f7b5cc4', 'repo:55f0c2816d6a', 'repo:instruction-engine', 'repo:elegy']), now, now, 'default');
      wpIds.push(wpId);

      const planId = `PLAN-CONSOLIDATION-TEST-${i}`;
      db.prepare(
        'INSERT OR REPLACE INTO plans (id, goal_id, roadmap_id, work_point_id, title, tags_json, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(planId, GOAL_ID, ROADMAP_IDS[i], wpId, `Test plan ${i}`, JSON.stringify(['repo:74af0f7b5cc4', 'repo:55f0c2816d6a', 'repo:instruction-engine', 'repo:elegy']), now, now, 'default');

      db.prepare(
        'INSERT OR REPLACE INTO todos (id, plan_id, work_point_id, title, tags_json, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(`TODO-CONSOLIDATION-TEST-${i}`, planId, wpId, `Test todo ${i}`, JSON.stringify(['repo:74af0f7b5cc4', 'repo:55f0c2816d6a', 'repo:instruction-engine', 'repo:elegy']), now, now, 'default');
    }
  });

  insert();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('dirty DB fails --strict validator (unscoped entities)', () => {
  const { tmpPath, db } = createTestDb();
  try {
    seedUntaggedEntities(db);
    db.close();

    const result = runValidator(tmpPath, ['--strict']);
    // Expect exit 1 because there are unscoped entities (goal + 5 roadmaps = 6)
    assert.strictEqual(result.status, 1, `expected exit 1, got ${result.status}`);
    assert.ok(result.stdout.includes('Unscoped'), 'expected unscoped section in output');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('repair + validator roundtrip: dirty → clean', () => {
  const { tmpPath, db } = createTestDb();
  try {
    seedUntaggedEntities(db);
    db.close();

    // Step 1: Run repair
    const repairResult = runRepair(tmpPath);
    assert.strictEqual(repairResult.status, 0, `repair exit: ${repairResult.status}, stderr: ${repairResult.stderr}`);

    // Step 2: Re-run validator with --strict, expect clean (exit 0)
    const validateResult = runValidator(tmpPath, ['--strict']);
    assert.strictEqual(validateResult.status, 0, `validator exit after repair: ${validateResult.status}, stdout: ${validateResult.stdout}`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('idempotency: re-run validator on clean DB stays clean', () => {
  const { tmpPath, db } = createTestDb();
  try {
    seedUntaggedEntities(db);
    db.close();

    // First repair
    runRepair(tmpPath);

    // Second repair (should be no-op)
    const repairResult = runRepair(tmpPath);
    assert.strictEqual(repairResult.status, 0, `second repair exit: ${repairResult.status}`);

    // Validate — should still be clean
    const validateResult = runValidator(tmpPath, ['--strict']);
    assert.strictEqual(validateResult.status, 0, `validator exit after second repair: ${validateResult.status}`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
