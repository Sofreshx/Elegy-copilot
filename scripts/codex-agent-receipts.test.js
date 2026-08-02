#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const agentsDir = path.resolve(__dirname, '..', 'codex-assets', 'agents');
const commonFields = [
  'taskId',
  'agentId',
  'role',
  'status',
  'ownedScope',
  'repositoryId',
  'baseRef',
  'headRef',
  'outcome',
  'evidence',
  'validation',
  'dependencies',
  'blockers',
  'residualRisks',
];
const roles = {
  explorer: 'exploration',
  reviewer: 'review',
  reviewer_strong: 'strongReview',
  worker: 'implementation',
  'test-runner': 'testRun',
  sweeper: 'cleanup',
};

for (const [agent, payloadKind] of Object.entries(roles)) {
  test(`${agent} emits the shared AGENT_RESULT receipt envelope`, () => {
    const content = fs.readFileSync(path.join(agentsDir, `${agent}.toml`), 'utf8');

    assert.match(content, /Always end with exactly one machine-readable AGENT_RESULT JSON object/i);
    assert.match(content, /AGENT_RESULT on the line before a fenced `json` object/i);
    for (const field of commonFields) {
      assert.match(content, new RegExp(`"${field}"`), `missing ${field}`);
    }
    assert.match(content, /"status": "completed\|partial\|blocked\|failed\|interrupted"/);
    for (const field of ['ownedScope', 'outcome', 'evidence', 'validation', 'dependencies', 'blockers', 'residualRisks']) {
      assert.match(content, new RegExp(`"${field}": \\[\\]`), `missing array shape for ${field}`);
    }
    assert.match(content, new RegExp(`"payload": \\{ "kind": "${payloadKind}"`));
  });
}
