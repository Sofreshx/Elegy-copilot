#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Script constants
// ---------------------------------------------------------------------------

const SCRIPT_VERSION = '1.0.0';
const KNOWN_DB_VERSIONS = [0];
const CORRELATION_ID = 'copilot-git-consolidation-20260603';
const OPERATOR = 'scripts/repair-consolidation-tags.mjs';

const GOAL_ID = 'GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603';
const ROADMAP_IDS = [
  'RM-COPILOT-GIT-UI-20260603',
  'RM-WORKTREE-MERGE-CONSISTENCY-20260603',
  'RM-VALIDATION-RECEIPTS-20260603',
  'RM-HOOKS-AGENT-LANE-ENFORCEMENT-20260603',
  'RM-CODEX-PLANNING-BOOTSTRAP-20260603',
];

const ROADMAP_THEMES = {
  'RM-COPILOT-GIT-UI-20260603': 'git-ui',
  'RM-WORKTREE-MERGE-CONSISTENCY-20260603': 'worktrees',
  'RM-VALIDATION-RECEIPTS-20260603': 'validation',
  'RM-HOOKS-AGENT-LANE-ENFORCEMENT-20260603': 'hooks',
  'RM-CODEX-PLANNING-BOOTSTRAP-20260603': 'codex-planning',
};

const REPO_TAGS = [
  'repo:74af0f7b5cc4',
  'repo:55f0c2816d6a',
  'repo:instruction-engine',
  'repo:elegy',
];
const SOURCE_TAG = 'source:codex';
const THEME_CONSOLIDATION = 'theme:consolidation';
const PHASE_TAG = 'phase:1';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

let dbPath = null;
let dryRun = false;

for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--db' && i + 1 < process.argv.length) {
    dbPath = process.argv[i + 1];
    i++;
  } else if (arg === '--dry-run') {
    dryRun = true;
  }
}

if (!dbPath) {
  console.error('Usage: node scripts/repair-consolidation-tags.mjs --db <path> [--dry-run]');
  process.exit(2);
}

dbPath = path.resolve(dbPath);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid() {
  return crypto.randomUUID();
}

function isoNow() {
  return new Date().toISOString();
}

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

function canonicalTagSet(existing, newTags) {
  const tagSet = new Set(existing);
  const labelIndex = new Map();

  for (const tag of tagSet) {
    const colon = tag.indexOf(':');
    if (colon !== -1) {
      labelIndex.set(
        tag.slice(0, colon).toLowerCase() + ':' + tag.slice(colon + 1).toLowerCase(),
        tag,
      );
    }
  }

  for (const tag of newTags) {
    tagSet.add(tag);
    const colon = tag.indexOf(':');
    if (colon !== -1) {
      labelIndex.set(
        tag.slice(0, colon).toLowerCase() + ':' + tag.slice(colon + 1).toLowerCase(),
        tag,
      );
    }
  }

  return Array.from(tagSet).sort();
}

function buildGoalTags(existing) {
  return canonicalTagSet(existing, [
    ...REPO_TAGS,
    SOURCE_TAG,
    THEME_CONSOLIDATION,
    PHASE_TAG,
  ]);
}

function buildRoadmapTags(existing, theme) {
  return canonicalTagSet(existing, [
    ...REPO_TAGS,
    SOURCE_TAG,
    'theme:' + theme,
    PHASE_TAG,
  ]);
}

function computeIdempotencyKey(entityType, entityId, canonicalTags) {
  const parts = [entityType, entityId, ...canonicalTags];
  return sha256(parts.join('|'));
}

function backupDb(dbPath) {
  const backupDir = path.join(os.homedir(), '.elegy', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = isoNow().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `elegy-planning.db.bak-${ts}`);
  fs.copyFileSync(dbPath, backupPath);

  const srcStat = fs.statSync(dbPath);
  const bakStat = fs.statSync(backupPath);
  if (srcStat.size !== bakStat.size) {
    fs.unlinkSync(backupPath);
    throw new Error(`Backup file size mismatch: ${srcStat.size} vs ${bakStat.size}`);
  }

  return backupPath;
}

// ---------------------------------------------------------------------------
// Plan computation
// ---------------------------------------------------------------------------

function computePlan(db) {
  const plan = [];

  const goalRow = db.prepare('SELECT tags_json FROM goals WHERE id = ?').get(GOAL_ID);
  if (!goalRow) throw new Error(`Goal not found: ${GOAL_ID}`);

  const existingGoalTags = JSON.parse(goalRow.tags_json);
  const newGoalTags = buildGoalTags(existingGoalTags);
  const sortedExisting = [...existingGoalTags].sort();
  const sortedNew = [...newGoalTags].sort();

  if (JSON.stringify(sortedExisting) !== JSON.stringify(sortedNew)) {
    plan.push({
      entityType: 'goal',
      entityId: GOAL_ID,
      before: sortedExisting,
      after: sortedNew,
      idempotencyKey: computeIdempotencyKey('goal', GOAL_ID, sortedNew),
    });
  }

  for (const rid of ROADMAP_IDS) {
    const row = db.prepare('SELECT tags_json FROM roadmaps WHERE id = ?').get(rid);
    if (!row) throw new Error(`Roadmap not found: ${rid}`);

    const existing = JSON.parse(row.tags_json);
    const theme = ROADMAP_THEMES[rid];
    const newTags = buildRoadmapTags(existing, theme);
    const sortedExistingR = [...existing].sort();
    const sortedNewR = [...newTags].sort();

    if (JSON.stringify(sortedExistingR) !== JSON.stringify(sortedNewR)) {
      plan.push({
        entityType: 'roadmap',
        entityId: rid,
        before: sortedExistingR,
        after: sortedNewR,
        idempotencyKey: computeIdempotencyKey('roadmap', rid, sortedNewR),
      });
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Plan application
// ---------------------------------------------------------------------------

function applyPlan(db, plan) {
  const existingKeyStmt = db.prepare(
    "SELECT 1 FROM planning_events WHERE event_type = ? AND correlation_id = ? AND payload_json LIKE '%' || ? || '%' LIMIT 1",
  );

  const updateGoalTags = db.prepare(
    'UPDATE goals SET tags_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
  );
  const updateRoadmapTags = db.prepare(
    'UPDATE roadmaps SET tags_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
  );
  const deleteTagIndex = db.prepare('DELETE FROM tag_index WHERE entity_type = ? AND entity_id = ?');
  const insertTagIndex = db.prepare(
    'INSERT INTO tag_index (scope_key, entity_type, entity_id, tag) VALUES (?, ?, ?, ?)',
  );
  const insertEvent = db.prepare(
    `INSERT INTO planning_events
      (event_id, entity_type, entity_id, aggregate_type, aggregate_id,
       correlation_id, causation_id, run_id, stream_id, sequence,
       parent_event_id, event_type, timestamp, payload_json, scope_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = isoNow();
  const runId = `tag-repair-${isoNow().replace(/[:.]/g, '-')}`;
  let changes = 0;
  let events = 0;

  for (const entry of plan) {
    const existing = existingKeyStmt.get(
      'tag_repair_direct_sqlite',
      CORRELATION_ID,
      entry.idempotencyKey,
    );
    if (existing) {
      console.error(`[repair] SKIP ${entry.entityType} ${entry.entityId}: already repaired (idempotencyKey match).`);
      continue;
    }

    const newTagsJson = JSON.stringify(entry.after);

    if (entry.entityType === 'goal') {
      updateGoalTags.run(newTagsJson, now, entry.entityId);
    } else {
      updateRoadmapTags.run(newTagsJson, now, entry.entityId);
    }
    changes++;

    deleteTagIndex.run(entry.entityType, entry.entityId);
    for (const tag of entry.after) {
      insertTagIndex.run('default', entry.entityType, entry.entityId, tag);
    }

    insertEvent.run(
      uuid(),
      entry.entityType,
      entry.entityId,
      entry.entityType,
      entry.entityId,
      CORRELATION_ID,
      null,
      runId,
      entry.entityId,
      events + 1,
      null,
      'tag_repair_direct_sqlite',
      now,
      JSON.stringify({
        scriptVersion: SCRIPT_VERSION,
        operator: OPERATOR,
        runs: events + 1,
        before: entry.before,
        after: entry.after,
        idempotencyKey: entry.idempotencyKey,
      }),
      'default',
    );
    events++;
  }

  return { changes, events };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

console.error(`[repair] DB: ${dbPath}`);

// 1. Schema version check
const dbRead = new Database(dbPath, { readonly: true });
const [{ user_version }] = dbRead.pragma('user_version');
dbRead.close();

if (!KNOWN_DB_VERSIONS.includes(user_version)) {
  console.error(
    `[repair] ERROR: Unsupported DB schema version ${user_version}. Known: ${KNOWN_DB_VERSIONS.join(', ')}`,
  );
  process.exit(1);
}
console.error(`[repair] DB schema version: ${user_version} (supported)`);

// 2. Dry-run
if (dryRun) {
  const dbRO = new Database(dbPath, { readonly: true });
  const plan = computePlan(dbRO);
  dbRO.close();

  if (plan.length === 0) {
    console.error('[repair] DRY-RUN: No changes needed (tags already canonical).');
    process.exit(0);
  }

  console.error(`[repair] DRY-RUN: Would apply ${plan.length} changes:`);
  for (const entry of plan) {
    console.error(`  ${entry.entityType} ${entry.entityId}:`);
    console.error(`    before: ${JSON.stringify(entry.before)}`);
    console.error(`    after:  ${JSON.stringify(entry.after)}`);
  }
  console.error('[repair] DRY-RUN: Exiting without changes (exit code 2).');
  process.exit(2);
}

// 3. Backup
let backupPath;
try {
  backupPath = backupDb(dbPath);
  console.error(`[repair] Backup: ${backupPath}`);
} catch (err) {
  console.error(`[repair] ERROR: Backup failed: ${err.message}`);
  process.exit(1);
}

// 4. Open DB for write and apply
let db;
try {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const plan = computePlan(db);

  if (plan.length === 0) {
    console.error('[repair] No changes needed (tags already canonical).');
    db.close();
    process.exit(0);
  }

  const tx = db.transaction(() => {
    return applyPlan(db, plan);
  });

  const result = tx();

  // Post-state validation: check tag issues only (not missingWorkItems)
  const validatorScript = path.resolve(__dirname, 'validate-planning-metadata.js');
  if (fs.existsSync(validatorScript)) {
    console.error('[repair] Running post-repair validator...');
    let stdout = '';
    try {
      stdout = execSync(`node "${validatorScript}" --db "${dbPath}" --json`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw new Error(`Validator could not run against DB. Backup preserved at ${backupPath}`);
    }
    try {
      const result = JSON.parse(stdout);
      const tagIssues = (result.unscoped || []).length + (result.orphaned || []).length + (result.inconsistentTags || []).length;
      if (tagIssues > 0) {
        console.error(`[repair] Post-repair validator: ${tagIssues} tag issues remaining`);
        throw new Error(`Post-repair validation found ${tagIssues} tag issues. Backup preserved at ${backupPath}`);
      }
      const mwi = result.missingWorkItems ? result.missingWorkItems.length : 0;
      console.error(`[repair] Post-repair validator: PASS (0 tag issues, ${mwi} missingWorkItems noted)`);
    } catch (e) {
      if (e.message.includes('Post-repair validation')) throw e;
      throw new Error(`Failed to parse validator output. Backup preserved at ${backupPath}`);
    }
  } else {
    console.error('[repair] WARNING: Validator script not found, skipping post-repair validation.');
  }

  console.error(
    `[repair] SUCCESS: ${result.changes} entities updated, ${result.events} events emitted.`,
  );
  console.error(`[repair] Backup saved to: ${backupPath}`);
} catch (err) {
  console.error(`[repair] ERROR: ${err.message}`);
  try { if (db) db.close(); } catch {}
  process.exit(1);
}

db.close();
process.exit(0);
