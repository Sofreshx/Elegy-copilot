#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const skillPath = path.resolve(__dirname, '..', 'codex-assets', 'skills', 'goal-session-workflow', 'SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

test('activates only for meaningful long-work or repository risk', () => {
  for (const trigger of ['multiple repositories', 'dirty-worktree', 'dependency wave', 'context compaction', 'external cost', 'genuinely long work']) {
    assert.match(skill, new RegExp(trigger, 'i'), `missing risk trigger: ${trigger}`);
  }
  assert.match(skill, /Skip it for routine bounded work/i);
  assert.match(skill, /Never create a native goal.*explicit user request/is);
});

test('defines one concise visible baseline and one hidden machine record', () => {
  for (const label of ['Goal:', 'Success:', 'Scope:', 'Protected:', 'Waves:', 'Current:']) assert.match(skill, new RegExp(label));
  assert.match(skill, /<!-- ELEGY_SESSION_STATE\s*\n\{[\s\S]*"kind": "baseline"/);
  for (const field of ['goalId', 'goal', 'successCriteria', 'authority', 'scope', 'protected', 'dependencyWaves', 'current', 'repositories']) {
    assert.match(skill, new RegExp(`"${field}"`), `missing baseline field ${field}`);
  }
  assert.match(skill, /Emit the baseline once/i);
  assert.match(skill, /Do not follow it with an initial checkpoint/i);
});

test('uses differential checkpoints only at meaningful boundaries', () => {
  assert.match(skill, /wave completed/i);
  assert.match(skill, /real blocker or user decision/i);
  assert.match(skill, /deliberate interruption or handoff/i);
  assert.match(skill, /final closure/i);
  assert.match(skill, /Do not checkpoint merely because fan-out began/i);
  assert.match(skill, /"kind": "update"/);
  assert.match(skill, /Omission means unchanged/i);
  assert.match(skill, /empty array explicitly clears/i);
});

test('keeps defaults and runtime-owned observations out of agent records', () => {
  assert.match(skill, /Omit inactive modules entirely/i);
  assert.match(skill, /Normal assurance is omission/i);
  assert.match(skill, /runtime owns timestamps/i);
  assert.match(skill, /Git branch\/HEAD\/worktree observations/i);
  assert.doesNotMatch(skill, /blocked-uncommitted/);
  assert.match(skill, /uncommitted.*does not imply blocked/is);
});

test('defines compact resume, legacy, and optional delegation behavior', () => {
  assert.match(skill, /RUNTIME_RECONCILIATION/);
  assert.match(skill, /Stop before editing on\s+`drifted`/i);
  assert.match(skill, /Legacy `GOAL_SESSION_FRAME` and `SESSION_CHECKPOINT` blocks are unsupported/i);
  assert.match(skill, /fresh compact baseline/i);
  assert.match(skill, /compact context packet/i);
  assert.match(skill, /SHA-256/i);
});
