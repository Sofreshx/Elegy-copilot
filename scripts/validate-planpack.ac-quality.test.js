#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack.js');

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

function withTempPlanFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planpack-ac-quality-test-'));
  const filePath = path.join(dir, 'plan.md');
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runValidator(filePath, args = []) {
  return childProcess.spawnSync(process.execPath, [VALIDATOR_PATH, filePath, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function buildWuSpec({ wuId = 'WU-001', acceptanceCriteriaLines = [] } = {}) {
  const acLines = acceptanceCriteriaLines.length
    ? acceptanceCriteriaLines.map((line) => `- ${line}`).join('\n')
    : '- placeholder';

  return `### ${wuId} — AC Quality Sample\n\n#### Context\n- Keep structure valid for validator checks.\n\n#### Acceptance Criteria\n${acLines}\n\n#### Plan / Approach\n- Preserve deterministic behavior.\n\n#### Expected Files (optional)\n- scripts/validate-planpack.js (modify)\n\n#### Validation\n- node scripts/validate-planpack.js <planpack>`;
}

function buildPlanPack({
  wuSpecs,
  graphRows,
  indexRows,
} = {}) {
  const specs = Array.isArray(wuSpecs) && wuSpecs.length ? wuSpecs : [
    buildWuSpec({
      wuId: 'WU-001',
      acceptanceCriteriaLines: [
        'Validator accepts planpack with at least two measurable AC bullets.',
        'Validator reports deterministic output format for success and failure.',
      ],
    }),
  ];
  const evidenceTimestamp = new Date().toISOString();

  const graph = Array.isArray(graphRows) && graphRows.length ? graphRows : [
    '| G-01-foundation | WU-001 | AC quality baseline | [] | [] | yes |',
  ];

  const index = Array.isArray(indexRows) && indexRows.length ? indexRows : [
    '| G-01-foundation | WU-001 | AC quality baseline | ### WU-001 — AC quality baseline |',
  ];

  return `# Plan Pack — AC Quality Test\n<!-- IE_PLAN_PACK_VERSION: 1 -->\n## Goal + Success Criteria\n- Goal: Validate AC quality checks.\n- Success Criteria:\n  - AC quality checks are deterministic.\n\n## Context Loaded (exact files)\n- scripts/validate-planpack.js\n\n## Assumptions + Constraints\n- Keep parser behavior stable.\n\n## Decisions (with rationale)\n- Add AC quality validations via optional enforcement mode.\n\n## Dropped / Deferred\n- None.\n\n## Work Unit Groups\n| Group | Title | Depends On | Parallel Notes |\n| --- | --- | --- | --- |\n| G-01-foundation | Foundation |  |  |\n\n## Work Unit Graph\n| Group | Work Unit ID | Title | Depends On | Next Units | Parallel Safe |\n| --- | --- | --- | --- | --- | --- |\n${graph.join('\n')}\n\n## Work Unit Index\n| Group | Work Unit ID | Title | Spec Heading |\n| --- | --- | --- | --- |\n${index.join('\n')}\n\n## Work Unit Specs\n\n${specs.join('\n\n')}\n\n## Execution Notes\n- Progress tracker follows canonical sections.\n\n## Risks / Rollback\n- Risk: false positives from vague phrase detection.\n\n## Validation\n- node scripts/validate-planpack.js <planpack>\n\n# Plan-Pack Progress Tracker\n<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->\n\n## Session Metadata\n- Session ID: 20260301_000000_AC_QUALITY\n- Date: 2026-03-01\n- Owner: test\n\n## Work Unit Groups Overview\n| Group | Title | Status | Depends On |\n| --- | --- | --- | --- |\n| G-01 | Foundation | done | — |\n| G-02 | Stream 2 | done | G-01 |\n| G-03 | Stream 3 | done | G-01 |\n| G-04 | Stream 4 | done | G-01 |\n\n## Work Unit Status Table\n| Group | Work Unit ID | Status | Next Unit | Notes |\n| --- | --- | --- | --- | --- |\n| G-01 | WU-001 | done | — | baseline complete |\n\n## Checkpoints\n| Group | Checkpoint | Trigger | Notes |\n| --- | --- | --- | --- |\n| G-01 | unit-tests | after group completion | status: passed |\n| G-02 | unit-tests | after group completion | status: passed |\n| G-03 | unit-tests | after group completion | status: passed |\n| G-04 | unit-tests | after group completion | status: passed |\n\n## Stream Evidence\n| Group | Predicate | Evidence | Status | Notes |\n| --- | --- | --- | --- | --- |\n| G-01 | execution-log and/or stream-marker | attestation://g01 | passed | status: passed |\n| G-02 | execution-log and/or stream-marker | attestation://g02 | passed | status: passed |\n| G-03 | execution-log and/or stream-marker | attestation://g03 | passed | status: passed |\n| G-04 | execution-log and/or stream-marker | attestation://g04 | passed | status: passed |\n\n## Final Gate Controls\n| Control | Status | Waiver Scope | Waiver Release | Waiver Audit | Notes |\n| --- | --- | --- | --- | --- | --- |\n| evidencePredicates | passed |  |  |  | stream evidence satisfied |\n| finalGateWaiverPrecedence | passed |  |  |  | waiver rules satisfied |\n| trustedEvidenceBindingRetention | passed |  |  |  | retention evidence satisfied |\n\n## Trusted Evidence Binding\n| Commit SHA | Release Tag | Channel | Producer Identity | Attestation Status | Evidence Timestamp | Evidence | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| deadbeefcafebabe | release-2026.03.01.1 | stable | github-actions://instruction-engine/desktop-release | true | 2026-03-01T00:00:00.000Z | attestation://release-2026.03.01.1 | attested build record |\n\n## Evidence Retention\n| Policy | Retention Days | Retained | Release Tag | Evidence | Notes |\n| --- | --- | --- | --- | --- | --- |\n| opsLogs | 30 | true | release-2026.03.01.1 | ops-log://retention/current | >= 30d |\n| perReleaseEvidence | 365 | true | release-2026.03.01.1 | evidence://release-2026.03.01.1 | present |\n\n## Execution Log\n- 2026-03-01T00:00:00.000Z — G-01 completed (status: passed)\n- 2026-03-01T00:01:00.000Z — G-02 completed (status: passed)\n- 2026-03-01T00:02:00.000Z — G-03 completed (status: passed)\n- 2026-03-01T00:03:00.000Z — G-04 completed (status: passed)\n`.replace('2026-03-01T00:00:00.000Z', evidenceTimestamp);
}

test('enforces minimum AC bullet count in fail mode when Acceptance Criteria is missing bullets', () => {
  const planContent = buildPlanPack({
    wuSpecs: [
      `### WU-001 — Missing AC Bullets\n\n#### Context\n- Keep structure valid.\n\n#### Acceptance Criteria\nText only without bullet markers.\n\n#### Plan / Approach\n- Keep deterministic behavior.\n\n#### Validation\n- node scripts/validate-planpack.js <planpack>`,
    ],
  });

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath, ['--ac-enforcement', 'fail']);
    assert.notStrictEqual(result.status, 0, 'validator should fail when AC bullet count is below threshold');
    assert.match(result.stderr, /AC quality failed: WU-001 Acceptance Criteria must include at least 2 bullet items \(found 0\)/i);
  });
});

test('enforces minimum AC bullet count in fail mode when only one bullet exists', () => {
  const planContent = buildPlanPack({
    wuSpecs: [
      buildWuSpec({
        wuId: 'WU-001',
        acceptanceCriteriaLines: ['Validator returns success for valid planpacks.'],
      }),
    ],
  });

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath, ['--ac-enforcement=fail']);
    assert.notStrictEqual(result.status, 0, 'validator should fail when only one AC bullet exists');
    assert.match(result.stderr, /found 1\)/i);
  });
});

test('warn mode emits warnings and exits zero for minimum AC count violations', () => {
  const planContent = buildPlanPack({
    wuSpecs: [
      buildWuSpec({
        wuId: 'WU-001',
        acceptanceCriteriaLines: ['Validator returns deterministic errors.'],
      }),
    ],
  });

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath, ['--ac-enforcement', 'warn']);
    assert.strictEqual(result.status, 0, `warn mode should pass, stderr: ${result.stderr}`);
    assert.match(result.stderr, /planpack warning:/i);
    assert.match(result.stderr, /AC quality warning: WU-001 Acceptance Criteria must include at least 2 bullet items \(found 1\)/i);
    assert.match(result.stdout, /planpack ok \(1 work units\)/i);
  });
});

test('detects vague AC criteria with line-aware diagnostics in fail mode', () => {
  const planContent = buildPlanPack({
    wuSpecs: [
      buildWuSpec({
        wuId: 'WU-001',
        acceptanceCriteriaLines: [
          'Output quality is good for all planpacks.',
          'Messages are proper for each validation step.',
        ],
      }),
    ],
  });

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath, ['--ac-enforcement', 'fail']);
    assert.notStrictEqual(result.status, 0, 'validator should fail on vague AC criteria in fail mode');
    assert.match(result.stderr, /AC quality failed: WU-001 Acceptance Criteria line \d+ is vague:/i);
  });
});

test('warn mode reports vague AC criteria but remains successful', () => {
  const planContent = buildPlanPack({
    wuSpecs: [
      buildWuSpec({
        wuId: 'WU-001',
        acceptanceCriteriaLines: [
          'Output quality is good for all planpacks.',
          'Diagnostic formatting remains deterministic and parseable.',
        ],
      }),
    ],
  });

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath, ['--ac-enforcement=warn']);
    assert.strictEqual(result.status, 0, 'warn mode should not fail on vague AC criteria');
    assert.match(result.stderr, /AC quality warning: WU-001 Acceptance Criteria line \d+ is vague:/i);
    assert.match(result.stdout, /planpack ok/i);
  });
});

test('fail mode reports multiple AC quality issues across multiple WUs', () => {
  const planContent = buildPlanPack({
    wuSpecs: [
      buildWuSpec({
        wuId: 'WU-001',
        acceptanceCriteriaLines: [
          'Output quality is good for reviewers.',
          'Line-aware diagnostics include file and rule context.',
        ],
      }),
      buildWuSpec({
        wuId: 'WU-002',
        acceptanceCriteriaLines: ['Validator behavior stays deterministic.'],
      }),
    ],
    graphRows: [
      '| G-01-foundation | WU-001 | AC quality baseline | [] | [WU-002] | yes |',
      '| G-01-foundation | WU-002 | AC quality follow-up | [WU-001] | [] | yes |',
    ],
    indexRows: [
      '| G-01-foundation | WU-001 | AC quality baseline | ### WU-001 — AC quality baseline |',
      '| G-01-foundation | WU-002 | AC quality follow-up | ### WU-002 — AC quality follow-up |',
    ],
  });

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath, ['--ac-enforcement=fail']);
    assert.notStrictEqual(result.status, 0, 'validator should fail with multiple AC quality violations');
    assert.match(result.stderr, /WU-001 Acceptance Criteria line \d+ is vague/i);
    assert.match(result.stderr, /WU-002 Acceptance Criteria must include at least 2 bullet items \(found 1\)/i);
  });
});

test('default mode remains backward compatible for valid planpack input', () => {
  const planContent = buildPlanPack();

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath);
    assert.strictEqual(result.status, 0, `valid planpack should pass in default mode, stderr: ${result.stderr}`);
    assert.match(result.stdout, /planpack ok \(1 work units\)/i);
    assert.strictEqual(result.stderr.trim(), '', 'default valid execution should not emit warnings/errors');
  });
});

test('fail mode passes on valid non-vague AC criteria with minimum bullet count', () => {
  const planContent = buildPlanPack({
    wuSpecs: [
      buildWuSpec({
        wuId: 'WU-001',
        acceptanceCriteriaLines: [
          'Validator returns exit code 0 for valid versioned planpacks.',
          'Validator reports final gate conformance for all required controls.',
        ],
      }),
    ],
  });

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath, ['--ac-enforcement', 'fail']);
    assert.strictEqual(result.status, 0, `valid planpack should pass in fail mode, stderr: ${result.stderr}`);
    assert.match(result.stdout, /planpack ok \(1 work units\)/i);
    assert.strictEqual(result.stderr.trim(), '', 'valid fail-mode run should not emit warnings/errors');
  });
});

test('default warn mode emits warning but preserves compatibility by exiting zero on AC quality issues', () => {
  const planContent = buildPlanPack({
    wuSpecs: [
      buildWuSpec({
        wuId: 'WU-001',
        acceptanceCriteriaLines: ['This is good enough.'],
      }),
    ],
  });

  withTempPlanFile(planContent, (filePath) => {
    const result = runValidator(filePath);
    assert.strictEqual(result.status, 0, 'default mode should remain non-failing for AC quality warnings');
    assert.match(result.stderr, /planpack warning:/i);
    assert.match(result.stderr, /AC quality warning:/i);
    assert.match(result.stdout, /planpack ok \(1 work units\)/i);
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
