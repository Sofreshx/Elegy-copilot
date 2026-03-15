'use strict';
const assert = require('assert');
const { buildSessionIdentity, mergeSessionGroup, dedupeAllSources, applySessionReconciliation } = require('./sessions');

// --- Test helpers ---
function makeSession(id, source, lastEventTime, extra = {}) {
  return { id, source, lastEventTime, startTime: null, repo: null, branch: null, cwd: null, mode: null, status: 'idle', ...extra };
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

// --- WU-101: buildSessionIdentity ---
test('buildSessionIdentity normalizes id', () => {
  const r = buildSessionIdentity({ id: '  AbC  ' });
  assert.strictEqual(r.canonicalKey, 'abc');
  assert.strictEqual(r.dedupeEligible, true);
});

test('buildSessionIdentity marks missing id as non-eligible', () => {
  const r1 = buildSessionIdentity({ id: '' });
  assert.strictEqual(r1.dedupeEligible, false);
  assert.strictEqual(r1.canonicalKey, null);

  const r2 = buildSessionIdentity({});
  assert.strictEqual(r2.dedupeEligible, false);

  const r3 = buildSessionIdentity({ id: '   ' });
  assert.strictEqual(r3.dedupeEligible, false);
});

// --- WU-102: mergeSessionGroup ---
test('two sessions same id different sources → merged to 1 with mergedCount 2', () => {
  const a = makeSession('sess-1', 'cli', 1000);
  const b = makeSession('sess-1', 'vscode', 2000);
  const merged = mergeSessionGroup([a, b]);
  assert.strictEqual(merged.mergedCount, 2);
  assert.ok(merged.sources.includes('cli'));
  assert.ok(merged.sources.includes('vscode'));
  assert.strictEqual(merged.canonicalKey, 'sess-1');
  assert.strictEqual(merged.dedupeEligible, true);
  assert.strictEqual(merged.authority, 'fs');
  assert.strictEqual(merged.reconciliation.reason, 'artifact_only');
  assert.strictEqual(merged.reconciliation.resolvedStatus, 'idle');
  assert.deepStrictEqual(merged.reconciliation.sourceSet, ['cli', 'vscode']);
});

test('tie-break: same timestamps, same completeness → source rank decides (vscode > cli)', () => {
  const a = makeSession('sess-2', 'cli', 5000);
  const b = makeSession('sess-2', 'vscode', 5000);
  const merged = mergeSessionGroup([a, b]);
  assert.strictEqual(merged.canonicalSource, 'vscode');
});

test('3+ sources merged to 1 with mergedCount 3', () => {
  const a = makeSession('sess-3', 'cli', 1000);
  const b = makeSession('sess-3', 'vscode', 2000);
  const c = makeSession('sess-3', 'sandbox', 500);
  const merged = mergeSessionGroup([a, b, c]);
  assert.strictEqual(merged.mergedCount, 3);
  assert.deepStrictEqual(merged.sources.sort(), ['cli', 'sandbox', 'vscode']);
});

// --- WU-103: dedupeAllSources ---
test('dedupeAllSources merges duplicate sessions', () => {
  const all = [
    makeSession('dup-1', 'cli', 1000),
    makeSession('dup-1', 'vscode', 2000),
    makeSession('unique-1', 'sandbox', 3000),
  ];
  const result = dedupeAllSources(all);
  assert.strictEqual(result.length, 2);
  const dup = result.find(s => s.canonicalKey === 'dup-1');
  assert.ok(dup);
  assert.strictEqual(dup.mergedCount, 2);
  assert.strictEqual(dup.dedupeReason, 'merged-2-sources');
  assert.strictEqual(dup.authority, 'fs');
  assert.strictEqual(dup.reconciliation.reason, 'artifact_only');
  assert.deepStrictEqual(dup.resolvedSourceSet, ['cli', 'vscode']);
  const unique = result.find(s => s.canonicalKey === 'unique-1');
  assert.ok(unique);
  assert.strictEqual(unique.mergedCount, 1);
  assert.strictEqual(unique.dedupeReason, 'unique');
  assert.strictEqual(unique.reconciliation.resolvedStatus, 'idle');
});

test('session with no id → dedupeEligible false, emitted as-is', () => {
  const all = [
    makeSession(undefined, 'cli', 1000),
    makeSession('real-1', 'vscode', 2000),
  ];
  const result = dedupeAllSources(all);
  assert.strictEqual(result.length, 2);
  const noId = result.find(s => !s.dedupeEligible);
  assert.ok(noId);
  assert.strictEqual(noId.dedupeReason, 'no-id');
  assert.strictEqual(noId.canonicalKey, null);
  assert.strictEqual(noId.authority, 'fs');
  assert.strictEqual(noId.reconciliation.reason, 'artifact_only');
});

// --- WU-104: dedupe=off semantics (no merging, additive metadata only) ---
test('dedupe=off → no merging, all rows present with additive metadata', () => {
  const all = [
    makeSession('dup-1', 'cli', 1000),
    makeSession('dup-1', 'vscode', 2000),
  ];
  // Simulate dedupe=off: apply identity and canonical reconciliation metadata without merging
  const result = all.map((s) => applySessionReconciliation({ ...s, ...buildSessionIdentity(s) }));
  assert.strictEqual(result.length, 2);
  assert.ok(result.every(s => s.canonicalKey === 'dup-1'));
  assert.ok(result.every(s => s.dedupeEligible === true));
  // Original source fields are preserved
  assert.strictEqual(result[0].source, 'cli');
  assert.strictEqual(result[1].source, 'vscode');
  assert.ok(result.every((s) => s.authority === 'fs'));
  assert.ok(result.every((s) => s.reconciliation && s.reconciliation.reason === 'artifact_only'));
});

test('applySessionReconciliation resolves runtime+artifact authority deterministically', () => {
  const base = makeSession('runtime-1', 'cli', 1000, { status: 'idle' });
  const reconciled = applySessionReconciliation(base, {
    hasRuntimeState: true,
    hasArtifactState: true,
    resolvedStatus: 'active',
    sourceSet: ['acp', 'cli'],
  });

  assert.strictEqual(reconciled.authority, 'acp');
  assert.strictEqual(reconciled.reconciliation.reason, 'runtime_and_artifact');
  assert.strictEqual(reconciled.reconciliation.resolvedStatus, 'active');
  assert.deepStrictEqual(reconciled.reconciliation.sourceSet, ['acp', 'cli']);
  assert.deepStrictEqual(reconciled.reconciliation.sourcePrecedence, ['runtime', 'artifact']);
});

test('applySessionReconciliation resolves runtime-only authority with runtime precedence', () => {
  const base = makeSession('runtime-only-1', 'sandbox', 1000, { status: 'active' });
  const reconciled = applySessionReconciliation(base, {
    hasRuntimeState: true,
    hasArtifactState: false,
    sourceSet: ['vscode', 'cli', 'cli'],
    resolvedStatus: 'active',
  });

  assert.strictEqual(reconciled.authority, 'acp');
  assert.strictEqual(reconciled.reconciliation.reason, 'runtime_only');
  assert.strictEqual(reconciled.reconciliation.sourceOfTruth, 'runtime');
  assert.deepStrictEqual(reconciled.reconciliation.sourcePrecedence, ['runtime']);
  assert.strictEqual(reconciled.reconciliation.hasRuntimeState, true);
  assert.strictEqual(reconciled.reconciliation.hasArtifactState, false);
  assert.deepStrictEqual(reconciled.resolvedSourceSet, ['cli', 'vscode']);
});

test('applySessionReconciliation falls back to artifact authority deterministically when both sources are absent', () => {
  const base = makeSession('fallback-1', 'cli', 1000, { status: '' });
  const reconciled = applySessionReconciliation(base, {
    hasRuntimeState: false,
    hasArtifactState: false,
    sourceSet: ['vscode', 'cli', 'vscode'],
  });

  assert.strictEqual(reconciled.authority, 'fs');
  assert.strictEqual(reconciled.reconciliation.reason, 'artifact_fallback');
  assert.strictEqual(reconciled.reconciliation.sourceOfTruth, 'artifact');
  assert.deepStrictEqual(reconciled.reconciliation.sourcePrecedence, ['artifact']);
  assert.strictEqual(reconciled.reconciliation.hasRuntimeState, false);
  assert.strictEqual(reconciled.reconciliation.hasArtifactState, false);
  assert.strictEqual(reconciled.reconciliation.resolvedStatus, 'missing');
  assert.deepStrictEqual(reconciled.resolvedSourceSet, ['cli', 'vscode']);
});

// --- Determinism ---
test('mergeSessionGroup is deterministic', () => {
  const a = makeSession('det-1', 'cli', 5000, { repo: 'r1' });
  const b = makeSession('det-1', 'vscode', 5000, { repo: 'r1' });
  const r1 = mergeSessionGroup([a, b]);
  const r2 = mergeSessionGroup([b, a]);
  assert.strictEqual(r1.canonicalSource, r2.canonicalSource);
  assert.strictEqual(r1.mergedCount, r2.mergedCount);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
