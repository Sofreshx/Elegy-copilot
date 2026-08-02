#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const skillPath = path.resolve(__dirname, '..', 'codex-assets', 'skills', 'goal-session-workflow', 'SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

test('goal session skill emits a machine-readable durable frame with planning identities', () => {
  assert.match(skill, /GOAL_SESSION_FRAME\s*```json/);
  for (const field of ['scopeKey', 'goalRef', 'roadmapRef', 'planRef', 'workPointRefs', 'projectRunRef', 'authorityStatus']) {
    assert.match(skill, new RegExp(`"${field}"`), `missing planning identity ${field}`);
  }
  assert.match(skill, /planning_surface: roadmap\|both/);
  assert.match(skill, /"assurancePolicy"/);
  assert.match(skill, /"attentionSignals"/);
  for (const field of ['gateRef', 'evidenceRefs', 'decisionRef']) {
    assert.match(skill, new RegExp(`"${field}"`), `missing assurance evidence field ${field}`);
  }
  assert.match(skill, /normal.*advisory.*strict/s);
});

test('goal session skill defines resume reconciliation and git checkpoint evidence', () => {
  assert.match(skill, /Resume from checkpoint/i);
  for (const field of ['worktreeStatus', 'ownedPaths', 'changedPaths', 'commitRef', 'resume', 'gitCheckpoint']) {
    assert.match(skill, new RegExp(`"${field}"`), `missing resume field ${field}`);
  }
  assert.match(skill, /drift/i);
  assert.match(skill, /clean-no-commit/);
  assert.match(skill, /blocked-uncommitted/);
});

test('goal session skill requires a bounded context packet for every delegate', () => {
  assert.match(skill, /AGENT_CONTEXT_PACKET/);
  assert.match(skill, /AGENT_CONTEXT_PACKET\s*```json/);
  for (const field of ['goalId', 'planningRefs', 'activeWaveId', 'ownedScope', 'validation', 'checkpointRef', 'contextHash']) {
    assert.match(skill, new RegExp(field), `missing context packet field ${field}`);
  }
  assert.match(skill, /"repositories"/);
  assert.match(skill, /SHA-256/);
  assert.match(skill, /same-session checkpoint|verified checkpoint/i);
});

test('goal session skill keeps assurance optional and attention signals non-blocking', () => {
  assert.match(skill, /optional manual reasoning or result check/i);
  assert.match(skill, /never blocks delivery/i);
  assert.match(skill, /at most 12 signals/i);
  assert.match(skill, /evidenceRefs/);
  assert.match(skill, /Signals never generate a review loop/i);
  assert.match(skill, /never.*scheduler|scheduled evaluation/s);
});
