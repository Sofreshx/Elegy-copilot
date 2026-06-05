#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(__dirname, 'validate-planning-metadata.js');
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

function createEmptyDb() {
  const tmpPath = path.join(os.tmpdir(), `vpm-test-${Date.now()}-${Math.random()}.db`);
  const db = new Database(tmpPath);
  db.pragma('user_version = 0');
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY, title TEXT, tags_json TEXT,
      revision INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT,
      scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS roadmaps (
      id TEXT PRIMARY KEY, goal_id TEXT REFERENCES goals(id),
      title TEXT, tags_json TEXT, revision INTEGER DEFAULT 1,
      created_at TEXT, updated_at TEXT, scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS work_points (
      id TEXT PRIMARY KEY, roadmap_id TEXT REFERENCES roadmaps(id),
      title TEXT, tags_json TEXT, revision INTEGER DEFAULT 1,
      created_at TEXT, updated_at TEXT, scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY, goal_id TEXT, roadmap_id TEXT, work_point_id TEXT,
      title TEXT, tags_json TEXT, revision INTEGER DEFAULT 1,
      created_at TEXT, updated_at TEXT, scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY, plan_id TEXT, work_point_id TEXT,
      title TEXT, tags_json TEXT, revision INTEGER DEFAULT 1,
      created_at TEXT, updated_at TEXT, scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, title TEXT, tags_json TEXT,
      revision INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT,
      scope_key TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS review_points (
      id TEXT PRIMARY KEY, title TEXT, tags_json TEXT,
      revision INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT,
      scope_key TEXT DEFAULT 'default'
    );
  `);
  db.close();
  return tmpPath;
}

function loadJsonResult(result) {
  return JSON.parse(result.stdout);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seedCleanDb(tmpPath) {
  const db = new Database(tmpPath);
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('GOAL-001', 'Main goal', JSON.stringify(['repo:elegy']), now, now, 'default');

  db.prepare(
    'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('RM-001', 'GOAL-001', 'Roadmap 1', JSON.stringify(['repo:elegy']), now, now, 'default');

  db.prepare(
    'INSERT INTO work_points (id, roadmap_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('WP-001', 'RM-001', 'Work Point 1', JSON.stringify(['repo:elegy']), now, now, 'default');

  db.prepare(
    'INSERT INTO plans (id, goal_id, roadmap_id, work_point_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('PLAN-001', 'GOAL-001', 'RM-001', 'WP-001', 'Plan 1', JSON.stringify(['repo:elegy']), now, now, 'default');

  db.prepare(
    'INSERT INTO todos (id, plan_id, work_point_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('TODO-001', 'PLAN-001', 'WP-001', 'Todo 1', JSON.stringify(['repo:elegy']), now, now, 'default');

  db.prepare(
    'INSERT INTO issues (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('ISSUE-001', 'Issue 1', JSON.stringify(['repo:elegy']), now, now, 'default');

  db.prepare(
    'INSERT INTO review_points (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('RP-001', 'Review Point 1', JSON.stringify(['repo:elegy']), now, now, 'default');

  db.close();
}

function seedUnscopedDb(tmpPath) {
  const db = new Database(tmpPath);
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('GOAL-U001', 'Unscoped goal', JSON.stringify(['phase:1']), now, now, 'default');

  db.prepare(
    'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('RM-U001', 'GOAL-U001', 'Unscoped roadmap', JSON.stringify(['phase:1']), now, now, 'default');

  db.close();
}

function seedOrphanedDb(tmpPath) {
  const db = new Database(tmpPath);
  db.pragma('foreign_keys = OFF');
  const now = new Date().toISOString();

  // A goal for reference (but we'll orphan roadmaps against non-existent goals)
  db.prepare(
    'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('GOAL-O001', 'Orphan parent', JSON.stringify(['repo:test']), now, now, 'default');

  // Roadmap with non-existent goal_id
  db.prepare(
    'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('RM-O001', 'GOAL-MISSING', 'Orphaned roadmap', JSON.stringify(['repo:test']), now, now, 'default');

  // Work point with non-existent roadmap_id
  db.prepare(
    'INSERT INTO work_points (id, roadmap_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('WP-O001', 'RM-MISSING', 'Orphaned work point', JSON.stringify(['repo:test']), now, now, 'default');

  db.close();
}

function seedInvalidParentDb(tmpPath) {
  const db = new Database(tmpPath);
  db.pragma('foreign_keys = OFF');
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('GOAL-I001', 'Good goal', JSON.stringify(['repo:test']), now, now, 'default');

  // Roadmap with empty-string goal_id
  db.prepare(
    'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('RM-I001', '', 'Empty parent ID', JSON.stringify(['repo:test']), now, now, 'default');

  db.close();
}

function seedDuplicateTitleDb(tmpPath) {
  const db = new Database(tmpPath);
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('GOAL-D001', 'Duplicate title', JSON.stringify(['repo:test']), now, now, 'default');

  db.prepare(
    'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('GOAL-D002', 'Duplicate title', JSON.stringify(['repo:test']), now, now, 'default');

  db.close();
}

function seedInconsistentTagsDb(tmpPath) {
  const db = new Database(tmpPath);
  const now = new Date().toISOString();

  // Goal has repo:elegy and repo:custom — roadmap only has repo:elegy
  db.prepare(
    'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('GOAL-C001', 'Goal with tags', JSON.stringify(['repo:elegy', 'repo:custom']), now, now, 'default');

  db.prepare(
    'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('RM-C001', 'GOAL-C001', 'Roadmap missing repo:custom', JSON.stringify(['repo:elegy']), now, now, 'default');

  // Roadmap has repo:custom — work_point has none
  db.prepare(
    'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('RM-C002', 'GOAL-C001', 'Roadmap with custom', JSON.stringify(['repo:elegy', 'repo:custom']), now, now, 'default');

  db.prepare(
    'INSERT INTO work_points (id, roadmap_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('WP-C001', 'RM-C002', 'WP missing repo:custom', JSON.stringify(['repo:elegy']), now, now, 'default');

  db.close();
}

function seedMissingWorkItemsDb(tmpPath) {
  const db = new Database(tmpPath);
  const now = new Date().toISOString();

  // A goal
  db.prepare(
    'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('GOAL-W001', 'Goal', JSON.stringify(['repo:test']), now, now, 'default');

  // Roadmap with zero work_points, plans, and todos
  db.prepare(
    'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run('RM-W001', 'GOAL-W001', 'Empty roadmap', JSON.stringify(['repo:test']), now, now, 'default');

  db.close();
}

function seedSchemaMismatchDb() {
  const tmpPath = path.join(os.tmpdir(), `vpm-test-${Date.now()}-${Math.random()}.db`);
  const db = new Database(tmpPath);
  db.pragma('user_version = 99');
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY, title TEXT, tags_json TEXT,
      revision INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT,
      scope_key TEXT DEFAULT 'default'
    );
  `);
  db.close();
  return tmpPath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('exits 2 when --db is missing', () => {
  const result = run();
  assert.strictEqual(result.status, 2, `exit code: ${result.status}`);
});

test('exits 2 when --db points to non-existent file', () => {
  const result = run('--db', 'C:\\nonexistent\\path\\db.db');
  assert.strictEqual(result.status, 2, `exit code: ${result.status}`);
});

test('exits 2 for unsupported DB schema version', () => {
  const tmpPath = seedSchemaMismatchDb();
  try {
    const result = run('--db', tmpPath);
    assert.strictEqual(result.status, 2, `exit code: ${result.status}`);
    assert.ok(result.stderr.includes('Unsupported'), 'expected version error');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('clean DB reports zero issues', () => {
  const tmpPath = createEmptyDb();
  try {
    seedCleanDb(tmpPath);
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);
    assert.strictEqual(parsed.unscoped.length, 0, 'expected zero unscoped');
    assert.strictEqual(parsed.orphaned.length, 0, 'expected zero orphaned');
    assert.strictEqual(parsed.invalidParents.length, 0, 'expected zero invalidParents');
    assert.strictEqual(parsed.duplicateTitles.length, 0, 'expected zero duplicateTitles');
    assert.strictEqual(parsed.inconsistentTags.length, 0, 'expected zero inconsistentTags');
    assert.strictEqual(parsed.missingWorkItems.length, 0, 'expected zero missingWorkItems');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('detects unscoped entities (no repo:* tags)', () => {
  const tmpPath = createEmptyDb();
  try {
    seedUnscopedDb(tmpPath);
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    // Should have 2 unscoped (goal + roadmap)
    assert.ok(parsed.unscoped.length >= 2, `expected at least 2 unscoped, got ${parsed.unscoped.length}`);

    const goalUnscoped = parsed.unscoped.find((e) => e.entityType === 'goal' && e.entityId === 'GOAL-U001');
    assert.ok(goalUnscoped, 'expected GOAL-U001 in unscoped');

    const rmUnscoped = parsed.unscoped.find((e) => e.entityType === 'roadmap' && e.entityId === 'RM-U001');
    assert.ok(rmUnscoped, 'expected RM-U001 in unscoped');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('detects orphaned entities (parent ID points to nothing)', () => {
  const tmpPath = createEmptyDb();
  try {
    seedOrphanedDb(tmpPath);
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    assert.ok(parsed.orphaned.length >= 2, `expected at least 2 orphaned, got ${parsed.orphaned.length}`);

    const rmOrphaned = parsed.orphaned.find((e) => e.entityType === 'roadmap' && e.entityId === 'RM-O001');
    assert.ok(rmOrphaned, 'expected RM-O001 in orphaned');
    assert.strictEqual(rmOrphaned.parentField, 'goal_id');
    assert.strictEqual(rmOrphaned.parentId, 'GOAL-MISSING');

    const wpOrphaned = parsed.orphaned.find((e) => e.entityType === 'work_point' && e.entityId === 'WP-O001');
    assert.ok(wpOrphaned, 'expected WP-O001 in orphaned');
    assert.strictEqual(wpOrphaned.parentField, 'roadmap_id');
    assert.strictEqual(wpOrphaned.parentId, 'RM-MISSING');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('detects invalid parent IDs (empty string)', () => {
  const tmpPath = createEmptyDb();
  try {
    seedInvalidParentDb(tmpPath);
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    assert.ok(parsed.invalidParents.length >= 1, `expected at least 1 invalidParent, got ${parsed.invalidParents.length}`);

    const rmInvalid = parsed.invalidParents.find((e) => e.entityType === 'roadmap' && e.entityId === 'RM-I001');
    assert.ok(rmInvalid, 'expected RM-I001 in invalidParents');
    assert.strictEqual(rmInvalid.parentField, 'goal_id');
    assert.strictEqual(rmInvalid.parentId, '');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('detects duplicate titles within same entity type', () => {
  const tmpPath = createEmptyDb();
  try {
    seedDuplicateTitleDb(tmpPath);
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    assert.ok(parsed.duplicateTitles.length >= 1, `expected at least 1 duplicateTitle, got ${parsed.duplicateTitles.length}`);

    const dup = parsed.duplicateTitles.find((e) => e.title === 'Duplicate title' && e.entityType === 'goal');
    assert.ok(dup, 'expected duplicate title for goals');
    assert.ok(dup.entityIds.includes('GOAL-D001'), 'expected GOAL-D001');
    assert.ok(dup.entityIds.includes('GOAL-D002'), 'expected GOAL-D002');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('detects inconsistent tags (child missing repo:* tags parent has)', () => {
  const tmpPath = createEmptyDb();
  try {
    seedInconsistentTagsDb(tmpPath);
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    assert.ok(parsed.inconsistentTags.length >= 2, `expected at least 2 inconsistentTags, got ${parsed.inconsistentTags.length}`);

    // Check goal→roadmap inconsistency: RM-C001 missing repo:custom
    const rmInconsistent = parsed.inconsistentTags.find(
      (e) => e.entityType === 'roadmap' && e.entityId === 'RM-C001' && e.parentId === 'GOAL-C001',
    );
    assert.ok(rmInconsistent, 'expected RM-C001 in inconsistentTags');
    assert.ok(rmInconsistent.missingTags.includes('repo:custom'), `expected missing repo:custom, got ${JSON.stringify(rmInconsistent.missingTags)}`);

    // Check roadmap→work_point inconsistency: WP-C001 missing repo:custom
    const wpInconsistent = parsed.inconsistentTags.find(
      (e) => e.entityType === 'work_point' && e.entityId === 'WP-C001' && e.parentId === 'RM-C002',
    );
    assert.ok(wpInconsistent, 'expected WP-C001 in inconsistentTags');
    assert.ok(wpInconsistent.missingTags.includes('repo:custom'), `expected missing repo:custom, got ${JSON.stringify(wpInconsistent.missingTags)}`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('detects missing work items (roadmap with zero work_points, plans, or todos)', () => {
  const tmpPath = createEmptyDb();
  try {
    seedMissingWorkItemsDb(tmpPath);
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    const missing = parsed.missingWorkItems.find((e) => e.entityId === 'RM-W001');
    assert.ok(missing, 'expected RM-W001 in missingWorkItems');
    assert.strictEqual(missing.workPoints, 0, 'expected 0 workPoints');
    assert.strictEqual(missing.plans, 0, 'expected 0 plans');
    assert.strictEqual(missing.todos, 0, 'expected 0 todos');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('--json flag produces valid JSON output', () => {
  const tmpPath = createEmptyDb();
  try {
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    assert.ok(Array.isArray(parsed.unscoped));
    assert.ok(Array.isArray(parsed.orphaned));
    assert.ok(Array.isArray(parsed.invalidParents));
    assert.ok(Array.isArray(parsed.duplicateTitles));
    assert.ok(Array.isArray(parsed.inconsistentTags));
    assert.ok(Array.isArray(parsed.missingWorkItems));
    assert.ok(typeof parsed.summary === 'object');
    assert.ok(typeof parsed.strict === 'boolean');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('--strict exits 1 when problems found', () => {
  const tmpPath = createEmptyDb();
  try {
    seedUnscopedDb(tmpPath);
    const result = run('--db', tmpPath, '--strict');
    assert.strictEqual(result.status, 1, `expected exit 1 in strict mode, got ${result.status}`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('non-strict exits 0 even with problems', () => {
  const tmpPath = createEmptyDb();
  try {
    seedUnscopedDb(tmpPath);
    const result = run('--db', tmpPath);
    assert.strictEqual(result.status, 0, `expected exit 0 in non-strict mode, got ${result.status}`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('pretty mode output matches expected format', () => {
  const tmpPath = createEmptyDb();
  try {
    seedUnscopedDb(tmpPath);
    const result = run('--db', tmpPath);
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    assert.ok(result.stdout.includes('[Unscoped]'), 'expected [Unscoped] section');
    assert.ok(result.stdout.includes('[Orphaned]'), 'expected [Orphaned] section');
    assert.ok(result.stdout.includes('Summary:'), 'expected Summary section');
    assert.ok(result.stdout.includes('strict: false'), 'expected strict: false');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('summary object in JSON reflects correct counts', () => {
  const tmpPath = createEmptyDb();
  try {
    seedUnscopedDb(tmpPath);
    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    assert.strictEqual(parsed.summary.unscoped, parsed.unscoped.length);
    assert.strictEqual(parsed.summary.orphaned, parsed.orphaned.length);
    assert.strictEqual(parsed.summary.invalidParents, parsed.invalidParents.length);
    assert.strictEqual(parsed.summary.duplicateTitles, parsed.duplicateTitles.length);
    assert.strictEqual(parsed.summary.inconsistentTags, parsed.inconsistentTags.length);
    assert.strictEqual(parsed.summary.missingWorkItems, parsed.missingWorkItems.length);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('all problems in one DB are reported together', () => {
  const tmpPath = createEmptyDb();
  try {
    const db = new Database(tmpPath);
    db.pragma('foreign_keys = OFF');
    const now = new Date().toISOString();

    // Seed all problem types
    // Unscoped goal (no repo:* tag)
    db.prepare(
      'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
    ).run('GOAL-ALL-001', 'Unscoped goal', JSON.stringify(['phase:1']), now, now, 'default');

    // Proper goal with roadmap that has empty goal_id (invalid parent)
    db.prepare(
      'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
    ).run('GOAL-ALL-002', 'Proper goal', JSON.stringify(['repo:elegy']), now, now, 'default');

    // Roadmap with empty goal_id -> invalidParent
    db.prepare(
      'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    ).run('RM-ALL-001', '', 'Roadmap invalid parent', JSON.stringify(['repo:elegy']), now, now, 'default');

    // Roadmap with non-existent goal_id -> orphaned
    db.prepare(
      'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    ).run('RM-ALL-002', 'GOAL-NOEXIST', 'Roadmap orphaned', JSON.stringify(['repo:elegy']), now, now, 'default');

    // Goal with repo:custom, roadmap missing it -> inconsistentTags
    db.prepare(
      'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
    ).run('GOAL-ALL-003', 'Goal with custom', JSON.stringify(['repo:elegy', 'repo:custom']), now, now, 'default');

    db.prepare(
      'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    ).run('RM-ALL-003', 'GOAL-ALL-003', 'Roadmap missing custom', JSON.stringify(['repo:elegy']), now, now, 'default');

    // Duplicate titles
    db.prepare(
      'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
    ).run('GOAL-ALL-004', 'Shared title', JSON.stringify(['repo:test']), now, now, 'default');
    db.prepare(
      'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
    ).run('GOAL-ALL-005', 'Shared title', JSON.stringify(['repo:test']), now, now, 'default');

    db.close();

    const result = run('--db', tmpPath, '--json');
    assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
    const parsed = loadJsonResult(result);

    assert.ok(parsed.summary.unscoped >= 1, 'expected unscoped items');
    assert.ok(parsed.summary.invalidParents >= 1, 'expected invalidParents');
    assert.ok(parsed.summary.orphaned >= 1, 'expected orphaned');
    assert.ok(parsed.summary.inconsistentTags >= 1, 'expected inconsistentTags');
    assert.ok(parsed.summary.duplicateTitles >= 1, 'expected duplicateTitles');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('--strict exits 1 with combined problems', () => {
  const tmpPath = createEmptyDb();
  try {
    const db = new Database(tmpPath);
    db.pragma('foreign_keys = OFF');
    const now = new Date().toISOString();

    // Unscoped goal + orphaned roadmap = 2 problem categories
    db.prepare(
      'INSERT INTO goals (id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, 1, ?, ?, ?)',
    ).run('GOAL-S001', 'Unscoped', JSON.stringify(['phase:1']), now, now, 'default');

    db.prepare(
      'INSERT INTO roadmaps (id, goal_id, title, tags_json, revision, created_at, updated_at, scope_key) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    ).run('RM-S001', 'GOAL-MISSING', 'Orphan', JSON.stringify(['repo:test']), now, now, 'default');

    db.close();

    const result = run('--db', tmpPath, '--strict', '--json');
    assert.strictEqual(result.status, 1, `expected exit 1 in strict mode, got ${result.status}`);

    const parsed = loadJsonResult(result);
    assert.strictEqual(parsed.strict, true, 'expected strict: true');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

// ---------------------------------------------------------------------------
// Final summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
