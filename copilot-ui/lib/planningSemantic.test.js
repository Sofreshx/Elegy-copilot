'use strict';

const assert = require('assert');

const {
  SEMANTIC_SCORING_CONTRACT_VERSION,
  SEMANTIC_DEGRADED_MODE,
  EMBEDDING_LIFECYCLE_STATE,
  SEMANTIC_GATE_STATUS,
  scorePlanningCandidate,
  sortPlanningCandidates,
  determineSemanticDegradedMode,
  classifyEmbeddingLifecycle,
  evaluateSemanticGate,
} = require('./planningSemantic');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

test('scorePlanningCandidate returns deterministic contract payload', () => {
  const input = {
    recordId: 'rec-1',
    scope: 'repo',
    status: 'implemented',
    semanticScore: 0.72,
    lexicalScore: 0.19,
    title: 'Alpha Candidate',
    updatedAt: '2026-02-25T10:00:00.000Z',
    createdAt: '2026-02-24T10:00:00.000Z',
  };

  const first = scorePlanningCandidate(input, 0);
  const second = scorePlanningCandidate(input, 0);

  assert.deepStrictEqual(first, second);
  assert.strictEqual(first.contractVersion, SEMANTIC_SCORING_CONTRACT_VERSION);
  assert.strictEqual(first.candidateId, 'rec-1');
  assert.strictEqual(typeof first.score, 'number');
});

test('sortPlanningCandidates is deterministic and stable for ties', () => {
  const candidates = [
    {
      candidateId: 'b',
      scope: 'repo',
      status: 'queued',
      semanticScore: 0.5,
      lexicalScore: 0.2,
      title: 'beta',
      updatedAt: '2026-02-24T10:00:00.000Z',
      createdAt: '2026-02-23T10:00:00.000Z',
    },
    {
      candidateId: 'a',
      scope: 'repo',
      status: 'queued',
      semanticScore: 0.5,
      lexicalScore: 0.2,
      title: 'alpha',
      updatedAt: '2026-02-24T10:00:00.000Z',
      createdAt: '2026-02-23T10:00:00.000Z',
    },
    {
      candidateId: 'c',
      scope: 'user',
      status: 'implemented',
      semanticScore: 0.9,
      lexicalScore: 0.4,
      title: 'charlie',
      updatedAt: '2026-02-25T10:00:00.000Z',
      createdAt: '2026-02-24T10:00:00.000Z',
    },
  ];

  const firstPass = sortPlanningCandidates(candidates);
  const secondPass = sortPlanningCandidates(candidates);

  assert.deepStrictEqual(firstPass, secondPass);
  assert.deepStrictEqual(firstPass.map((entry) => entry.candidateId), ['c', 'a', 'b']);
});

test('determineSemanticDegradedMode reports lexical fallback trigger matrix', () => {
  const baseline = determineSemanticDegradedMode({
    semanticEnabled: true,
    embeddingsAvailable: true,
    embeddingRecord: { embedding: [0.1, 0.2], modelVersion: 'v1', expectedModelVersion: 'v1' },
  });

  assert.deepStrictEqual(baseline, {
    degraded: false,
    degradedMode: SEMANTIC_DEGRADED_MODE.SEMANTIC_PRIMARY,
    degradedReasons: [],
    semanticUsed: true,
  });

  const degraded = determineSemanticDegradedMode({
    semanticEnabled: false,
    embeddingsAvailable: false,
    semanticTimeout: true,
    semanticError: new Error('upstream failure'),
    embeddingRecord: {
      embedding: [0.1, 0.2],
      modelVersion: 'v0',
      expectedModelVersion: 'v1',
    },
    semanticGate: {
      gateStatus: SEMANTIC_GATE_STATUS.INSUFFICIENT_DATA,
    },
  });

  assert.strictEqual(degraded.degraded, true);
  assert.strictEqual(degraded.degradedMode, SEMANTIC_DEGRADED_MODE.LEXICAL_FALLBACK);
  assert.strictEqual(degraded.semanticUsed, false);
  assert.deepStrictEqual(degraded.degradedReasons, [
    'embedding_reembed_required',
    'embedding_unavailable',
    'insufficient_data',
    'semantic_disabled',
    'semantic_error',
    'semantic_timeout',
  ]);
});

test('classifyEmbeddingLifecycle handles ready, backfill, reembed, and poison with markers', () => {
  const ready = classifyEmbeddingLifecycle({
    embedding: [0.1],
    modelVersion: 'v1',
    expectedModelVersion: 'v1',
    contentHash: 'abc',
    expectedContentHash: 'abc',
  });
  assert.strictEqual(ready.state, EMBEDDING_LIFECYCLE_STATE.READY);
  assert.deepStrictEqual(ready.reasonCodes, ['embedding_ready']);
  assert.strictEqual(ready.retryMarker, false);

  const backfill = classifyEmbeddingLifecycle({
    embedding: [],
    retryCount: 4,
  });
  assert.strictEqual(backfill.state, EMBEDDING_LIFECYCLE_STATE.NEEDS_BACKFILL);
  assert.strictEqual(backfill.retryMarker, true);
  assert.strictEqual(backfill.backpressureMarker, true);
  assert.deepStrictEqual(backfill.reasonCodes, ['embedding_missing']);

  const reembed = classifyEmbeddingLifecycle({
    embedding: [0.3],
    modelVersion: 'old',
    expectedModelVersion: 'new',
    contentHash: 'a',
    expectedContentHash: 'b',
  });
  assert.strictEqual(reembed.state, EMBEDDING_LIFECYCLE_STATE.NEEDS_REEMBED);
  assert.strictEqual(reembed.retryMarker, true);
  assert.deepStrictEqual(reembed.reasonCodes, ['content_hash_mismatch', 'model_version_mismatch']);

  const poisoned = classifyEmbeddingLifecycle({
    poisoned: true,
    poisonReason: 'embedding_nan',
  });
  assert.strictEqual(poisoned.state, EMBEDDING_LIFECYCLE_STATE.POISONED);
  assert.strictEqual(poisoned.retryMarker, false);
  assert.deepStrictEqual(poisoned.reasonCodes, ['embedding_nan']);
});

test('evaluateSemanticGate enforces fail-closed pass/fail/insufficient-data and mergeEnabled behavior', () => {
  const pass = evaluateSemanticGate({
    latencyMs: 120,
    errorRate: 0.01,
    qualityScore: 0.92,
    sampleSize: 8,
  }, {
    maxLatencyMs: 500,
    maxErrorRate: 0.1,
    minQualityScore: 0.8,
    minSampleSize: 3,
    mergeEnabled: true,
  });
  assert.strictEqual(pass.gateStatus, SEMANTIC_GATE_STATUS.PASS);
  assert.strictEqual(pass.mergeEnabled, true);
  assert.strictEqual(pass.overrideEnvelope.overrideRequired, false);

  const passMergeDisabled = evaluateSemanticGate({
    latencyMs: 120,
    errorRate: 0.01,
    qualityScore: 0.92,
    sampleSize: 8,
  }, {
    maxLatencyMs: 500,
    maxErrorRate: 0.1,
    minQualityScore: 0.8,
    minSampleSize: 3,
    mergeEnabled: false,
  });
  assert.strictEqual(passMergeDisabled.gateStatus, SEMANTIC_GATE_STATUS.PASS);
  assert.strictEqual(passMergeDisabled.mergeEnabled, false);

  const fail = evaluateSemanticGate({
    latencyMs: 800,
    errorRate: 0.2,
    qualityScore: 0.4,
    sampleSize: 10,
  }, {
    maxLatencyMs: 500,
    maxErrorRate: 0.1,
    minQualityScore: 0.8,
    minSampleSize: 3,
    mergeEnabled: true,
  });
  assert.strictEqual(fail.gateStatus, SEMANTIC_GATE_STATUS.FAIL);
  assert.strictEqual(fail.mergeEnabled, false);
  assert.deepStrictEqual(fail.reasons, ['error_rate_exceeded', 'latency_exceeded', 'quality_below_minimum']);
  assert.strictEqual(fail.overrideEnvelope.overrideRequired, true);

  const insufficientData = evaluateSemanticGate({
    latencyMs: 120,
    errorRate: 0.01,
    qualityScore: null,
    sampleSize: 1,
  }, {
    maxLatencyMs: 500,
    maxErrorRate: 0.1,
    minQualityScore: 0.8,
    minSampleSize: 3,
    mergeEnabled: true,
  });
  assert.strictEqual(insufficientData.gateStatus, SEMANTIC_GATE_STATUS.INSUFFICIENT_DATA);
  assert.strictEqual(insufficientData.insufficientData, true);
  assert.strictEqual(insufficientData.mergeEnabled, false);
  assert.deepStrictEqual(insufficientData.reasons, ['insufficient_data']);
  assert.strictEqual(insufficientData.overrideEnvelope.overrideRequired, true);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}