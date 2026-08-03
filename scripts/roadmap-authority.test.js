#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const skill = fs.readFileSync(path.resolve(__dirname, '..', 'engine-assets', 'skills', 'roadmap-authoring', 'SKILL.md'), 'utf8');

test('roadmap authoring routes durable work to explicit elegy-planning authority', () => {
  assert.match(skill, /live durable authority is elegy-planning/i);
  assert.match(skill, /explicit `--scope <scope-key>`/);
  assert.match(skill, /file-shaped .*compatibility/i);
  assert.match(skill, /must not silently create a second\s+roadmap authority/i);
});

test('roadmap authoring does not present repo files as live authority', () => {
  assert.match(skill, /historical compatibility forms only/i);
  assert.match(skill, /Do not create or update these paths as a substitute/);
  assert.match(skill, /unimported draft/);
});
