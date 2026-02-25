'use strict';
const assert = require('assert');
const { buildSessionIdentity, mergeSessionGroup, dedupeAllSources } = require('./sessions');

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
  const unique = result.find(s => s.canonicalKey === 'unique-1');
  assert.ok(unique);
  assert.strictEqual(unique.mergedCount, 1);
  assert.strictEqual(unique.dedupeReason, 'unique');
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
});

// --- WU-104: dedupe=off semantics (no merging, additive metadata only) ---
test('dedupe=off → no merging, all rows present with additive metadata', () => {
  const all = [
    makeSession('dup-1', 'cli', 1000),
    makeSession('dup-1', 'vscode', 2000),
  ];
  // Simulate dedupe=off: apply buildSessionIdentity without merging
  const result = all.map(s => ({ ...s, ...buildSessionIdentity(s) }));
  assert.strictEqual(result.length, 2);
  assert.ok(result.every(s => s.canonicalKey === 'dup-1'));
  assert.ok(result.every(s => s.dedupeEligible === true));
  // Original source fields are preserved
  assert.strictEqual(result[0].source, 'cli');
  assert.strictEqual(result[1].source, 'vscode');
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
