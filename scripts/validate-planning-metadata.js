#!/usr/bin/env node
'use strict';

const Database = require('better-sqlite3');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_DB_VERSIONS = [0];

const ALL_ENTITY_TABLES = [
  'goals',
  'roadmaps',
  'work_points',
  'plans',
  'todos',
  'issues',
  'review_points',
];

const PARENT_FIELDS = {
  roadmaps:    { goal_id: 'goals' },
  work_points: { roadmap_id: 'roadmaps' },
  plans:       { goal_id: 'goals', roadmap_id: 'roadmaps', work_point_id: 'work_points' },
  todos:       { plan_id: 'plans', work_point_id: 'work_points' },
};

const INCONSISTENT_CHAINS = [
  { childTable: 'roadmaps',    childParentField: 'goal_id',      parentTable: 'goals' },
  { childTable: 'work_points', childParentField: 'roadmap_id',   parentTable: 'roadmaps' },
  { childTable: 'plans',       childParentField: 'work_point_id', parentTable: 'work_points' },
];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

let dbPath = null;
let jsonMode = false;
let strictMode = false;

for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--db' && i + 1 < process.argv.length) {
    dbPath = process.argv[++i];
  } else if (arg === '--json') {
    jsonMode = true;
  } else if (arg === '--strict') {
    strictMode = true;
  }
}

if (!dbPath) {
  console.error('Usage: node scripts/validate-planning-metadata.js --db <path> [--json] [--strict]');
  process.exit(2);
}

dbPath = path.resolve(dbPath);

// ---------------------------------------------------------------------------
// DB access
// ---------------------------------------------------------------------------

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (err) {
  console.error(`Failed to open database: ${err.message}`);
  process.exit(2);
}

// Schema version check
const [{ user_version }] = db.pragma('user_version');
if (!KNOWN_DB_VERSIONS.includes(user_version)) {
  console.error(
    `Unsupported DB schema version ${user_version}. Expected one of: ${KNOWN_DB_VERSIONS.join(', ')}`,
  );
  db.close();
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTags(row) {
  if (!row || !row.tags_json) return [];
  try {
    const parsed = JSON.parse(row.tags_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getRepoTags(tags) {
  return tags.filter((t) => typeof t === 'string' && t.startsWith('repo:'));
}

// ---------------------------------------------------------------------------
// Results accumulator
// ---------------------------------------------------------------------------

const results = {
  unscoped: [],
  orphaned: [],
  invalidParents: [],
  duplicateTitles: [],
  inconsistentTags: [],
  missingWorkItems: [],
};

// ---------------------------------------------------------------------------
// 1. Unscoped — entities without any repo:* tag
// ---------------------------------------------------------------------------

for (const table of ALL_ENTITY_TABLES) {
  const rows = db.prepare(`SELECT id, tags_json FROM ${table}`).all();
  for (const row of rows) {
    const tags = parseTags(row);
    if (getRepoTags(tags).length === 0) {
      results.unscoped.push({
        entityType: table.slice(0, -1), // singular
        entityId: row.id,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Orphaned — parent ID points to non-existent entity
// ---------------------------------------------------------------------------

for (const [table, parents] of Object.entries(PARENT_FIELDS)) {
  for (const [field, parentTable] of Object.entries(parents)) {
    const rows = db
      .prepare(`SELECT id, ${field} AS parentId FROM ${table} WHERE ${field} IS NOT NULL`)
      .all();
    for (const row of rows) {
      const parentExists = db
        .prepare(`SELECT 1 FROM ${parentTable} WHERE id = ?`)
        .get(row.parentId);
      if (!parentExists) {
        results.orphaned.push({
          entityType: table.slice(0, -1),
          entityId: row.id,
          parentField: field,
          parentId: row.parentId,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. InvalidParents — non-null parent ID that is malformed (empty / non-string)
// ---------------------------------------------------------------------------

for (const [table, parents] of Object.entries(PARENT_FIELDS)) {
  for (const field of Object.keys(parents)) {
    const rows = db
      .prepare(`SELECT id, ${field} AS parentId FROM ${table} WHERE ${field} IS NOT NULL`)
      .all();
    for (const row of rows) {
      if (typeof row.parentId !== 'string' || row.parentId.trim() === '') {
        results.invalidParents.push({
          entityType: table.slice(0, -1),
          entityId: row.id,
          parentField: field,
          parentId: row.parentId,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. DuplicateTitles — 2+ entities in same table sharing a non-empty title
// ---------------------------------------------------------------------------

for (const table of ALL_ENTITY_TABLES) {
  const rows = db
    .prepare(`SELECT id, title FROM ${table} WHERE title IS NOT NULL AND title != ''`)
    .all();
  const titleMap = {};
  for (const row of rows) {
    if (!titleMap[row.title]) titleMap[row.title] = [];
    titleMap[row.title].push(row.id);
  }
  for (const [title, ids] of Object.entries(titleMap)) {
    if (ids.length >= 2) {
      results.duplicateTitles.push({
        entityType: table.slice(0, -1),
        title,
        entityIds: ids,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 5. InconsistentTags — child entity missing repo:* tags its parent has
//    Only check goal→roadmap, roadmap→work_point, work_point→plan chains.
// ---------------------------------------------------------------------------

for (const chain of INCONSISTENT_CHAINS) {
  const { parentTable, childTable, childParentField } = chain;
  const parentRows = db.prepare(`SELECT id, tags_json FROM ${parentTable}`).all();

  for (const parent of parentRows) {
    const parentRepoTags = getRepoTags(parseTags(parent));
    if (parentRepoTags.length === 0) continue;

    const childRows = db
      .prepare(`SELECT id, tags_json FROM ${childTable} WHERE ${childParentField} = ?`)
      .all(parent.id);

    for (const child of childRows) {
      const childRepoTags = getRepoTags(parseTags(child));
      const missing = parentRepoTags.filter((t) => !childRepoTags.includes(t));
      if (missing.length > 0) {
        results.inconsistentTags.push({
          entityType: childTable.slice(0, -1),
          entityId: child.id,
          parentType: parentTable.slice(0, -1),
          parentId: parent.id,
          missingTags: missing,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 6. MissingWorkItems — roadmaps with zero work_points, plans, OR todos
// ---------------------------------------------------------------------------

const roadmapRows = db.prepare('SELECT id FROM roadmaps').all();
for (const rm of roadmapRows) {
  const wpCount = db
    .prepare('SELECT COUNT(*) AS c FROM work_points WHERE roadmap_id = ?')
    .get(rm.id).c;

  const planCount = db
    .prepare('SELECT COUNT(*) AS c FROM plans WHERE roadmap_id = ?')
    .get(rm.id).c;

  // Plans may also be linked through work_points (but we already count direct plans)
  const planViaWpCount = db
    .prepare(
      'SELECT COUNT(*) AS c FROM plans WHERE work_point_id IN (SELECT id FROM work_points WHERE roadmap_id = ?)',
    )
    .get(rm.id).c;

  const totalPlanCount = planCount + planViaWpCount;

  // Todos: through plans directly linked to this roadmap, or through work_points
  const todoViaPlanCount = db
    .prepare(
      'SELECT COUNT(*) AS c FROM todos WHERE plan_id IN (SELECT id FROM plans WHERE roadmap_id = ?)',
    )
    .get(rm.id).c;
  const todoViaWpCount = db
    .prepare(
      'SELECT COUNT(*) AS c FROM todos WHERE work_point_id IN (SELECT id FROM work_points WHERE roadmap_id = ?)',
    )
    .get(rm.id).c;

  const totalTodoCount = todoViaPlanCount + todoViaWpCount;

  if (wpCount === 0 || totalPlanCount === 0 || totalTodoCount === 0) {
    results.missingWorkItems.push({
      entityType: 'roadmap',
      entityId: rm.id,
      workPoints: wpCount,
      plans: totalPlanCount,
      todos: totalTodoCount,
    });
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

db.close();

const summary = {
  unscoped: results.unscoped.length,
  orphaned: results.orphaned.length,
  invalidParents: results.invalidParents.length,
  duplicateTitles: results.duplicateTitles.length,
  inconsistentTags: results.inconsistentTags.length,
  missingWorkItems: results.missingWorkItems.length,
};

if (jsonMode) {
  process.stdout.write(
    JSON.stringify({ ...results, summary, strict: strictMode }, null, 2) + '\n',
  );
} else {
  const sections = [
    ['Unscoped', results.unscoped],
    ['Orphaned', results.orphaned],
    ['InvalidParents', results.invalidParents],
    ['DuplicateTitles', results.duplicateTitles],
    ['InconsistentTags', results.inconsistentTags],
    ['MissingWorkItems', results.missingWorkItems],
  ];

  for (const [name, items] of sections) {
    const count = items.length;
    console.log(`[${name}] ${count} item(s)`);
    if (count > 0) {
      const display = items.slice(0, 10);
      for (const item of display) {
        console.log(`  - ${JSON.stringify(item)}`);
      }
      if (count > 10) {
        console.log(`  ... and ${count - 10} more`);
      }
    }
    console.log('');
  }

  console.log('Summary:');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`  strict: ${strictMode}`);
}

// ---------------------------------------------------------------------------
// Exit code
// ---------------------------------------------------------------------------

const hasProblems =
  results.unscoped.length > 0 ||
  results.orphaned.length > 0 ||
  results.inconsistentTags.length > 0 ||
  results.missingWorkItems.length > 0;

if (strictMode && hasProblems) {
  process.exit(1);
}
process.exit(0);
