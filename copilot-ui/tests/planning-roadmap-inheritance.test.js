#!/usr/bin/env node
'use strict';

const assert = require('assert');

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

// ---------------------------------------------------------------------------
// Inline copy of planningEntityMatchesRepoSelection from routes/planning.js
// The real function is module-local; this duplicates its core logic.
// ---------------------------------------------------------------------------

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringList(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function getPlanningEntityTags(entity) {
  return normalizeStringList(entity && entity.tags);
}

function normalizePathForPlanningComparison(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return '';
  return normalized.replace(/[\\/]+/g, '/').toLowerCase();
}

function planningEntityMatchesRepoSelection(entity, repo, parentRepo, parentTags) {
  const selection = repo && typeof repo === 'object' ? repo : null;
  const repoId = normalizeOptionalString(selection && selection.repoId);
  const repoPath = normalizePathForPlanningComparison(selection && selection.repoPath);
  const repoLabel = normalizeOptionalString(selection && selection.repoLabel);
  if (!repoId && !repoPath && !repoLabel) {
    return true;
  }

  const record = entity && typeof entity === 'object' ? entity : {};
  const tags = getPlanningEntityTags(record).map((tag) => tag.toLowerCase());
  if (repoId && tags.includes(`repo:${repoId}`.toLowerCase())) {
    return true;
  }

  const entityRepoId = normalizeOptionalString(record.repoId)
    || normalizeOptionalString(record.repositoryId)
    || normalizeOptionalString(record.repo && record.repo.repoId);
  if (repoId && entityRepoId && entityRepoId.toLowerCase() === repoId.toLowerCase()) {
    return true;
  }

  const entityRepoPath = normalizePathForPlanningComparison(record.repoPath)
    || normalizePathForPlanningComparison(record.repositoryPath)
    || normalizePathForPlanningComparison(record.repo && record.repo.repoPath);
  if (repoPath && entityRepoPath && entityRepoPath === repoPath) {
    return true;
  }

  const entityRepoLabel = normalizeOptionalString(record.repoLabel)
    || normalizeOptionalString(record.repositoryLabel)
    || normalizeOptionalString(record.repo && record.repo.repoLabel);
  if (repoLabel && entityRepoLabel && entityRepoLabel.toLowerCase() === repoLabel.toLowerCase()) {
    return true;
  }

  if (parentTags) {
    const inheritedLower = new Set(
      Array.isArray(parentTags) ? parentTags.map((t) => String(t).toLowerCase()) : [],
    );
    if (repoId && inheritedLower.has(`repo:${repoId}`.toLowerCase())) {
      return true;
    }
    if (repoLabel && inheritedLower.has(`repo:${repoLabel}`.toLowerCase())) {
      return true;
    }
  }

  if (parentRepo) {
    return planningEntityMatchesRepoSelection(entity, parentRepo, null, null);
  }

  return false;
}

function makeRepo(repoId, repoPath, repoLabel) {
  return { repoId: repoId || '', repoPath: repoPath || '', repoLabel: repoLabel || '' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('direct match: roadmap has repo:74af0f7b5cc4 tag, repo selects repoId=74af0f7b5cc4 → true', () => {
  const entity = { id: 'rm-1', tags: ['repo:74af0f7b5cc4'] };
  const repo = makeRepo('74af0f7b5cc4');
  const result = planningEntityMatchesRepoSelection(entity, repo, null, null);
  assert.strictEqual(result, true);
});

test('inherited match: roadmap has NO repo:* tag but parentTags includes repo:74af0f7b5cc4 → true', () => {
  const entity = { id: 'rm-1', tags: ['feature:git-ui'] };
  const repo = makeRepo('74af0f7b5cc4');
  const result = planningEntityMatchesRepoSelection(entity, repo, null, ['repo:74af0f7b5cc4']);
  assert.strictEqual(result, true);
});

test('no match: roadmap has no repo tag, no parentTags → false', () => {
  const entity = { id: 'rm-1', tags: ['feature:git-ui'] };
  const repo = makeRepo('74af0f7b5cc4');
  const result = planningEntityMatchesRepoSelection(entity, repo, null, null);
  assert.strictEqual(result, false);
});

test('label match: entity has repoLabel field matching repoLabel selection → true', () => {
  // The function checks entity.repoLabel against selection.repoLabel directly
  const entity = { id: 'rm-1', tags: [], repoLabel: 'instruction-engine' };
  const repo = makeRepo('', '', 'instruction-engine');
  const result = planningEntityMatchesRepoSelection(entity, repo, null, null);
  assert.strictEqual(result, true);
});

test('case-insensitive parent tag with different repo ID → false', () => {
  const entity = { id: 'rm-1', tags: [] };
  const repo = makeRepo('74af0f7b5cc4');
  // parentTags has repo:INSTRUCTION-ENGINE (upper), repo selects a different repoId
  const result = planningEntityMatchesRepoSelection(entity, repo, null, ['repo:INSTRUCTION-ENGINE']);
  assert.strictEqual(result, false);
});

test('includeUnscoped: entity has no repo tag, no repo selection → true (all pass)', () => {
  const entity = { id: 'rm-1', tags: ['feature:git-ui'] };
  // When repo selection is null/empty, the function returns true
  const result = planningEntityMatchesRepoSelection(entity, null, null, null);
  assert.strictEqual(result, true);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
