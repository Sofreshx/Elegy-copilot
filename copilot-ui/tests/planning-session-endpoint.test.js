#!/usr/bin/env node
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const planningSession = require('../lib/planningSession');
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
// Tests
// ---------------------------------------------------------------------------
test('resolveSessionSidecarPath — env var overrides default', () => {
  const customPath = path.join(os.tmpdir(), 'custom-session.json');
  const env = { INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH: customPath };
  const result = planningSession.resolveSessionSidecarPath(env, '/home/user', '/some/db.db');
  assert.strictEqual(result, path.resolve(customPath));
});
test('resolveSessionSidecarPath — when env var is not set, falls back to db-adjacent', () => {
  const dbPath = path.join(os.tmpdir(), 'elegy', 'planning.db');
  const result = planningSession.resolveSessionSidecarPath({}, '/home/user', dbPath);
  const expected = path.join(path.dirname(dbPath), 'planning-session.json');
  assert.strictEqual(result, expected);
});
test('resolveSessionSidecarPath — when neither env nor dbPath is set, falls back to ~/.elegy', () => {
  const result = planningSession.resolveSessionSidecarPath({}, '/home/user', null);
  const expected = path.join('/home/user', '.elegy', 'planning-session.json');
  assert.strictEqual(result, expected);
});
test('readPlanningSession — when file does not exist, returns exists: false', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-session-test-'));
  try {
    const env = {};
    const opts = { homedir: tmpDir, dbPath: path.join(tmpDir, 'nonexistent.db') };
    const result = planningSession.readPlanningSession(env, opts);
    assert.strictEqual(result.exists, false);
    assert.strictEqual(result.sidecar, null);
    assert.ok(Array.isArray(result.candidatePaths));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
});
test('readPlanningSession — candidatePaths lists all 3 paths in priority order', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-session-test-'));
  try {
    // Create a dummy file at the env override path to make it exist
    const envOverridePath = path.join(tmpDir, 'override-session.json');
    fs.writeFileSync(envOverridePath, JSON.stringify({ test: true }));
    const dbPath = path.join(tmpDir, 'data', 'planning.db');
    const env = { INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH: envOverridePath };
    const opts = { homedir: tmpDir, dbPath };
    const result = planningSession.readPlanningSession(env, opts);
    // We should have 3 candidate paths
    assert.ok(result.candidatePaths.length >= 2, `expected at least 2 candidates, got ${result.candidatePaths.length}`);
    // Priority 1 should be the env override
    const p1 = result.candidatePaths.find((c) => c.priority === '1');
    assert.ok(p1, 'expected priority 1 candidate');
    assert.strictEqual(p1.path, path.resolve(envOverridePath));
    assert.strictEqual(p1.exists, true);
    // Priority 2 should be db-adjacent
    const p2 = result.candidatePaths.find((c) => c.priority === '2');
    assert.ok(p2, 'expected priority 2 candidate');
    assert.strictEqual(p2.path, path.join(path.dirname(dbPath), 'planning-session.json'));
    assert.strictEqual(p2.exists, false);
    // Priority 3 should be ~/.elegy
    const p3 = result.candidatePaths.find((c) => c.priority === '3');
    assert.ok(p3, 'expected priority 3 candidate');
    assert.strictEqual(p3.path, path.join(tmpDir, '.elegy', 'planning-session.json'));
    assert.strictEqual(p3.exists, false);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
});
test('readPlanningSession — reads and parses an existing file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-session-test-'));
  try {
    const sessionPath = path.join(tmpDir, 'planning-session.json');
    const data = { version: 1, repos: ['repo:test'] };
    fs.writeFileSync(sessionPath, JSON.stringify(data));
    const env = {};
    const opts = { homedir: tmpDir, dbPath: path.join(tmpDir, 'elegy.db') };
    // The db-adjacent path won't exist, but the env path isn't set; effective will be db-adjacent which doesn't exist.
    // Actually the homedir fallback will point to tmpDir/.elegy/planning-session.json which doesn't exist.
    // Let's use env override to point directly at our session file.
    const env2 = { INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH: sessionPath };
    const result = planningSession.readPlanningSession(env2, opts);
    assert.strictEqual(result.exists, true);
    assert.deepStrictEqual(result.sidecar, data);
    assert.strictEqual(result.sidecarPath, path.resolve(sessionPath));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
});
test('mirrorSessionSidecar — when source exists and target does not, copies file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-session-test-'));
  try {
    const sourcePath = path.join(tmpDir, 'source-session.json');
    const targetPath = path.join(tmpDir, 'nested', 'target-session.json');
    fs.writeFileSync(sourcePath, JSON.stringify({ version: 1 }));
    const result = planningSession.mirrorSessionSidecar({
      resolvedPath: targetPath,
      defaultSourcePath: sourcePath,
      homedir: tmpDir,
    });
    assert.ok(result, 'expected a result object');
    assert.strictEqual(result.copiedFrom, sourcePath);
    assert.strictEqual(result.copiedTo, targetPath);
    assert.ok(fs.existsSync(targetPath), 'target file should exist');
    const content = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.deepStrictEqual(content, { version: 1 });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
});
test('mirrorSessionSidecar — when target already exists, returns null', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-session-test-'));
  try {
    const sourcePath = path.join(tmpDir, 'source-session.json');
    const targetPath = path.join(tmpDir, 'existing-target.json');
    fs.writeFileSync(sourcePath, JSON.stringify({ version: 1 }));
    fs.writeFileSync(targetPath, JSON.stringify({ version: 2 }));
    const result = planningSession.mirrorSessionSidecar({
      resolvedPath: targetPath,
      defaultSourcePath: sourcePath,
      homedir: tmpDir,
    });
    assert.strictEqual(result, null);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
});
// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
