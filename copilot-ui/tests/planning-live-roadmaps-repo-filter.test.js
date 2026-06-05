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
// Inline copy of filterPlanningLiveRoadmaps from routes/planning.js
// ---------------------------------------------------------------------------

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getPlanningEntityTags(entity) {
  if (!entity || !entity.tags) return [];
  const tags = Array.isArray(entity.tags) ? entity.tags : [];
  const seen = new Set();
  const result = [];
  for (const tag of tags) {
    const t = typeof tag === 'string' ? tag.trim() : '';
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    result.push(t);
  }
  return result;
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

function filterPlanningLiveRoadmaps(roadmaps, repo, opts) {
  const items = Array.isArray(roadmaps) ? roadmaps : [];
  if (items.length === 0) return [];
  const parentTagsMap = opts && opts.parentTagsMap instanceof Map ? opts.parentTagsMap : null;
  const includeUnscoped = opts && opts.includeUnscoped === true;

  return items.filter((roadmap) => {
    // Direct match
    if (planningEntityMatchesRepoSelection(roadmap, repo, null, null)) {
      return true;
    }

    // Inherited match via parentTagsMap
    if (parentTagsMap) {
      const goalTags = parentTagsMap.get(roadmap.id);
      if (goalTags && planningEntityMatchesRepoSelection(roadmap, repo, null, goalTags)) {
        return true;
      }
    }

    // includeUnscoped: roadmaps with no repo tags pass through
    if (includeUnscoped) {
      const tags = getPlanningEntityTags(roadmap).map((t) => t.toLowerCase());
      const hasRepoTags = tags.some((t) => t.startsWith('repo:'));
      if (!hasRepoTags) {
        return true;
      }
    }

    return false;
  });
}

function makeRepo(repoId) {
  return { repoId: repoId || '', repoPath: '', repoLabel: '' };
}

function makeRoadmap(id, tags, goalId) {
  return { id, title: `Roadmap ${id}`, tags: tags || [], goalId: goalId || null };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('includeUnscoped=true returns roadmaps without repo tags', () => {
  const roadmaps = [
    makeRoadmap('rm-1', ['feature:ui']),
    makeRoadmap('rm-2', ['repo:74af0f7b5cc4']),
    makeRoadmap('rm-3', []),
  ];

  const repo = makeRepo('74af0f7b5cc4');
  const result = filterPlanningLiveRoadmaps(roadmaps, repo, { includeUnscoped: true });

  // rm-1 has no repo tag → included via unscoped
  // rm-2 has matching repo tag → included via direct match
  // rm-3 has no repo tag → included via unscoped
  assert.strictEqual(result.length, 3);
});

test('includeUnscoped=false filters out roadmaps without repo tags', () => {
  const roadmaps = [
    makeRoadmap('rm-1', ['feature:ui']),
    makeRoadmap('rm-2', ['repo:74af0f7b5cc4']),
    makeRoadmap('rm-3', []),
  ];

  const repo = makeRepo('74af0f7b5cc4');
  const result = filterPlanningLiveRoadmaps(roadmaps, repo, { includeUnscoped: false });

  // Only rm-2 has matching repo tag
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'rm-2');
});

test('roadmap with matching repo:74af0f7b5cc4 tag passes filter', () => {
  const roadmaps = [
    makeRoadmap('rm-match', ['repo:74af0f7b5cc4', 'feature:ui']),
    makeRoadmap('rm-no-match', ['repo:other-repo', 'feature:ui']),
  ];

  const repo = makeRepo('74af0f7b5cc4');
  const result = filterPlanningLiveRoadmaps(roadmaps, repo, {});

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'rm-match');
});

test('roadmap without matching tag but with matching parentTags passes filter (inherited scope)', () => {
  const roadmaps = [
    makeRoadmap('rm-inherited', ['feature:ui'], 'GOAL-TEST-1'),
  ];

  const repo = makeRepo('74af0f7b5cc4');
  const parentTagsMap = new Map();
  parentTagsMap.set('rm-inherited', ['repo:74af0f7b5cc4']);

  const result = filterPlanningLiveRoadmaps(roadmaps, repo, { parentTagsMap });

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'rm-inherited');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
