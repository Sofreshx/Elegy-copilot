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
		passed++;
		console.log(`  PASS: ${name}`);
	} catch (error) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${error.message}`);
		process.exitCode = 1;
	}
}

function withTempPlanFile(content, fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planpack-final-gate-test-'));
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

function buildPlanPack({ finalGateRows, trustedEvidenceRows, retentionRows }) {
	const defaultReleaseTag = 'release-2026.02.25.1';
	const defaultTimestamp = new Date().toISOString();

	const rows = Array.isArray(finalGateRows)
		? finalGateRows
		: [
			{ control: 'evidencePredicates', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'streams valid' },
			{ control: 'finalGateWaiverPrecedence', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'precedence valid' },
			{ control: 'trustedEvidenceBindingRetention', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'retention valid' },
		];

	const trustedRows = Array.isArray(trustedEvidenceRows)
		? trustedEvidenceRows
		: [
			{
				commitSha: 'abc123def456',
				releaseTag: defaultReleaseTag,
				channel: 'stable',
				producerIdentity: 'github-actions://instruction-engine/desktop-release',
				attestationStatus: 'true',
				evidenceTimestamp: defaultTimestamp,
				evidence: 'attestation://release-2026.02.25.1',
				notes: 'ci attestation recorded',
			},
		];

	const retentionPolicyRows = Array.isArray(retentionRows)
		? retentionRows
		: [
			{
				policy: 'opsLogs',
				retentionDays: '30',
				retained: 'true',
				releaseTag: defaultReleaseTag,
				evidence: 'ops-log://retention/snapshot/2026-02-25',
				notes: 'ops retention policy active',
			},
			{
				policy: 'perReleaseEvidence',
				retentionDays: '365',
				retained: 'true',
				releaseTag: defaultReleaseTag,
				evidence: 'evidence://release-2026.02.25.1/bundle',
				notes: 'release evidence stored',
			},
		];

	return `# Plan Pack — Final Gate Validation Test
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Validate final gate control behavior.
- Success Criteria:
  - Validator enforces deterministic final controls.

## Context Loaded (exact files)
- scripts/validate-planpack.js

## Assumptions + Constraints
- Keep checks deterministic and parseable.

## Decisions (with rationale)
- Final gate controls evaluated per-control.

## Dropped / Deferred
- None.

## Work Unit Groups
| Group | Title | Depends On | Parallel Notes |
| --- | --- | --- | --- |
| G-01-foundation | Foundation |  |  |

## Work Unit Graph
| Group | Work Unit ID | Title | Depends On | Next Units | Parallel Safe |
| --- | --- | --- | --- | --- | --- |
| G-01-foundation | WU-001 | Baseline validator setup | [] | [] | yes |

## Work Unit Index
| Group | Work Unit ID | Title | Spec Heading |
| --- | --- | --- | --- |
| G-01-foundation | WU-001 | Baseline validator setup | ### WU-001 — Baseline validator setup |

## Work Unit Specs

### WU-001 — Baseline validator setup

#### Context
- Keep a minimal valid planpack around final gate checks.

#### Acceptance Criteria
- Planpack is structurally valid.
- Final gate controls are enforced.

#### Plan / Approach
- Validate final gate table rows.

#### Validation
- node scripts/validate-planpack.js <planpack>

## Execution Notes
- Progress tracker is append-only.

## Risks / Rollback
- Risk: waiver scope broadening.

## Validation
- node scripts/validate-planpack.js <planpack>

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Session Metadata
- Session ID: 20260225_000000_FINAL_GATE
- Date: 2026-02-25
- Owner: test

## Work Unit Groups Overview
| Group | Title | Status | Depends On |
| --- | --- | --- | --- |
| G-01 | Foundation | done | — |
| G-02 | Stream 2 | done | G-01 |
| G-03 | Stream 3 | done | G-01 |
| G-04 | Stream 4 | done | G-01 |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | — | baseline complete |

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
| G-02 | unit-tests | after group completion | status: passed |
| G-03 | unit-tests | after group completion | status: passed |
| G-04 | unit-tests | after group completion | status: passed |

## Stream Evidence
| Group | Predicate | Evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| G-01 | execution-log and/or stream-marker | test-evidence-1 | passed | status: passed |
| G-02 | execution-log and/or stream-marker | test-evidence-2 | passed | status: passed |
| G-03 | execution-log and/or stream-marker | test-evidence-3 | passed | status: passed |
| G-04 | execution-log and/or stream-marker | test-evidence-4 | passed | status: passed |

## Final Gate Controls
| Control | Status | Waiver Scope | Waiver Release | Waiver Audit | Notes |
| --- | --- | --- | --- | --- | --- |
${rows.map(row => `| ${row.control} | ${row.status} | ${row.waiverScope || ''} | ${row.waiverRelease || ''} | ${row.waiverAudit || ''} | ${row.notes || ''} |`).join('\n')}

## Trusted Evidence Binding
| Commit SHA | Release Tag | Channel | Producer Identity | Attestation Status | Evidence Timestamp | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
${trustedRows.map(row => `| ${row.commitSha || ''} | ${row.releaseTag || ''} | ${row.channel || ''} | ${row.producerIdentity || ''} | ${row.attestationStatus || ''} | ${row.evidenceTimestamp || ''} | ${row.evidence || ''} | ${row.notes || ''} |`).join('\n')}

## Evidence Retention
| Policy | Retention Days | Retained | Release Tag | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
${retentionPolicyRows.map(row => `| ${row.policy || ''} | ${row.retentionDays || ''} | ${row.retained || ''} | ${row.releaseTag || ''} | ${row.evidence || ''} | ${row.notes || ''} |`).join('\n')}

## Execution Log
- 2026-02-25T10:00:00Z — G-01 completed (status: passed)
- 2026-02-25T10:10:00Z — G-02 completed (status: passed)
- 2026-02-25T10:20:00Z — G-03 completed (status: passed)
- 2026-02-25T10:30:00Z — G-04 completed (status: passed)
`;
}

test('passes when all required final gate controls are passed', () => {
	const planContent = buildPlanPack({});
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.strictEqual(result.status, 0, `validator should pass, stderr: ${result.stderr}`);
	});
});

test('passes when one control is waived with valid scope and release-linked audit while others are passed', () => {
	const planContent = buildPlanPack({
		finalGateRows: [
			{ control: 'evidencePredicates', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'streams valid' },
			{
				control: 'finalGateWaiverPrecedence',
				status: 'waived',
				waiverScope: 'finalGateWaiverPrecedence',
				waiverRelease: 'release-2026.02.25.1',
				waiverAudit: 'audit://release-2026.02.25.1/final-gate-waiver',
				notes: 'temporary exception approved',
			},
			{ control: 'trustedEvidenceBindingRetention', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'retention valid' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.strictEqual(result.status, 0, `validator should pass, stderr: ${result.stderr}`);
	});
});

test('fails when waiver scope does not explicitly include the waived control', () => {
	const planContent = buildPlanPack({
		finalGateRows: [
			{ control: 'evidencePredicates', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'streams valid' },
			{
				control: 'finalGateWaiverPrecedence',
				status: 'waived',
				waiverScope: 'evidencePredicates',
				waiverRelease: 'release-2026.02.25.2',
				waiverAudit: 'audit://release-2026.02.25.2/final-gate-waiver',
				notes: 'invalid scope',
			},
			{ control: 'trustedEvidenceBindingRetention', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'retention valid' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0, 'validator should fail on scope mismatch');
		assert.match(result.stderr, /final gate waiver scope mismatch: finalGateWaiverPrecedence/i);
	});
});

test('fails when waiver is missing release-linked audit trail fields', () => {
	const planContent = buildPlanPack({
		finalGateRows: [
			{ control: 'evidencePredicates', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'streams valid' },
			{
				control: 'finalGateWaiverPrecedence',
				status: 'waived',
				waiverScope: 'finalGateWaiverPrecedence',
				waiverRelease: 'release-2026.02.25.3',
				waiverAudit: '',
				notes: 'missing audit field',
			},
			{ control: 'trustedEvidenceBindingRetention', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'retention valid' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0, 'validator should fail when waiver audit trail fields are incomplete');
		assert.match(result.stderr, /final gate waiver missing release-linked audit trail: finalGateWaiverPrecedence/i);
	});
});

test('fails when a required final control row is missing and not waived', () => {
	const planContent = buildPlanPack({
		finalGateRows: [
			{ control: 'evidencePredicates', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'streams valid' },
			{ control: 'finalGateWaiverPrecedence', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'precedence valid' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0, 'validator should fail when required control row is missing');
		assert.match(result.stderr, /missing required final gate control row: trustedEvidenceBindingRetention/i);
	});
});

test('passes with trusted evidence binding and retention when expected commit/release/channel match', () => {
	const planContent = buildPlanPack({
		trustedEvidenceRows: [
			{
				commitSha: 'deadbeefcafebabe',
				releaseTag: 'release-2026.02.25.10',
				channel: 'stable',
				producerIdentity: 'github-actions://instruction-engine/desktop-release',
				attestationStatus: 'true',
				evidenceTimestamp: '2026-02-25T11:00:00Z',
				evidence: 'attestation://release-2026.02.25.10',
				notes: 'attested build record',
			},
		],
		retentionRows: [
			{ policy: 'opsLogs', retentionDays: '30', retained: 'true', releaseTag: 'release-2026.02.25.10', evidence: 'ops-log://retention/current', notes: '>= 30d' },
			{ policy: 'perReleaseEvidence', retentionDays: '365', retained: 'true', releaseTag: 'release-2026.02.25.10', evidence: 'evidence://release-2026.02.25.10', notes: 'present' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, [
			'--expected-commit', 'deadbeefcafebabe',
			'--expected-release', 'release-2026.02.25.10',
			'--expected-channel', 'stable',
			'--max-evidence-age-hours', '24',
			'--now', '2026-02-25T12:00:00Z',
		]);
		assert.strictEqual(result.status, 0, `validator should pass, stderr: ${result.stderr}`);
	});
});

test('rejects forged or mismatched trusted evidence binding values', () => {
	const planContent = buildPlanPack({
		trustedEvidenceRows: [
			{
				commitSha: 'forged-commit',
				releaseTag: 'release-2026.02.25.11',
				channel: 'canary',
				producerIdentity: 'github-actions://instruction-engine/desktop-release',
				attestationStatus: 'true',
				evidenceTimestamp: '2026-02-25T11:00:00Z',
				evidence: 'attestation://release-2026.02.25.11',
				notes: 'binding mismatch sample',
			},
		],
		retentionRows: [
			{ policy: 'opsLogs', retentionDays: '30', retained: 'true', releaseTag: 'release-2026.02.25.11', evidence: 'ops-log://retention/current', notes: '>= 30d' },
			{ policy: 'perReleaseEvidence', retentionDays: '365', retained: 'true', releaseTag: 'release-2026.02.25.11', evidence: 'evidence://release-2026.02.25.11', notes: 'present' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, [
			'--expected-commit', 'expected-commit',
			'--expected-release', 'release-2026.02.25.11',
			'--expected-channel', 'stable',
			'--max-evidence-age-hours', '24',
			'--now', '2026-02-25T12:00:00Z',
		]);
		assert.notStrictEqual(result.status, 0, 'validator should fail on trusted binding mismatch');
		assert.match(result.stderr, /trusted evidence commit mismatch: expected expected-commit, got forged-commit/i);
	});
});

test('rejects trusted evidence timestamps that are too far in the future', () => {
	const planContent = buildPlanPack({
		trustedEvidenceRows: [
			{
				commitSha: 'deadbeefcafebabe',
				releaseTag: 'release-2026.02.25.15',
				channel: 'stable',
				producerIdentity: 'github-actions://instruction-engine/desktop-release',
				attestationStatus: 'true',
				evidenceTimestamp: '2026-02-25T14:00:00Z',
				evidence: 'attestation://release-2026.02.25.15',
				notes: 'future timestamp sample',
			},
		],
		retentionRows: [
			{ policy: 'opsLogs', retentionDays: '30', retained: 'true', releaseTag: 'release-2026.02.25.15', evidence: 'ops-log://retention/current', notes: '>= 30d' },
			{ policy: 'perReleaseEvidence', retentionDays: '365', retained: 'true', releaseTag: 'release-2026.02.25.15', evidence: 'evidence://release-2026.02.25.15', notes: 'present' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, [
			'--expected-commit', 'deadbeefcafebabe',
			'--expected-release', 'release-2026.02.25.15',
			'--expected-channel', 'stable',
			'--max-evidence-age-hours', '24',
			'--now', '2026-02-25T12:00:00Z',
		]);
		assert.notStrictEqual(result.status, 0, 'validator should fail on future trusted evidence');
		assert.match(result.stderr, /trusted evidence timestamp is in the future/i);
	});
});

test('rejects replayed or stale trusted evidence', () => {
	const planContent = buildPlanPack({
		trustedEvidenceRows: [
			{
				commitSha: 'deadbeefcafebabe',
				releaseTag: 'release-2026.02.25.12',
				channel: 'stable',
				producerIdentity: 'github-actions://instruction-engine/desktop-release',
				attestationStatus: 'true',
				evidenceTimestamp: '2026-02-01T00:00:00Z',
				evidence: 'attestation://release-2026.02.25.12',
				notes: 'stale evidence sample',
			},
		],
		retentionRows: [
			{ policy: 'opsLogs', retentionDays: '30', retained: 'true', releaseTag: 'release-2026.02.25.12', evidence: 'ops-log://retention/current', notes: '>= 30d' },
			{ policy: 'perReleaseEvidence', retentionDays: '365', retained: 'true', releaseTag: 'release-2026.02.25.12', evidence: 'evidence://release-2026.02.25.12', notes: 'present' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, [
			'--expected-commit', 'deadbeefcafebabe',
			'--expected-release', 'release-2026.02.25.12',
			'--expected-channel', 'stable',
			'--max-evidence-age-hours', '24',
			'--now', '2026-02-25T12:00:00Z',
		]);
		assert.notStrictEqual(result.status, 0, 'validator should fail on stale trusted evidence');
		assert.match(result.stderr, /trusted evidence is stale\/replayed/i);
	});
});

test('rejects retention policy failures for ops logs and per-release evidence', () => {
	const planContent = buildPlanPack({
		trustedEvidenceRows: [
			{
				commitSha: 'deadbeefcafebabe',
				releaseTag: 'release-2026.02.25.13',
				channel: 'stable',
				producerIdentity: 'github-actions://instruction-engine/desktop-release',
				attestationStatus: 'true',
				evidenceTimestamp: '2026-02-25T11:00:00Z',
				evidence: 'attestation://release-2026.02.25.13',
				notes: 'retention failure sample',
			},
		],
		retentionRows: [
			{ policy: 'opsLogs', retentionDays: '7', retained: 'true', releaseTag: 'release-2026.02.25.13', evidence: 'ops-log://retention/current', notes: '< 30d should fail' },
			{ policy: 'perReleaseEvidence', retentionDays: '365', retained: 'false', releaseTag: 'release-2026.02.25.13', evidence: 'evidence://release-2026.02.25.13', notes: 'must be retained' },
		],
	});

	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, [
			'--expected-commit', 'deadbeefcafebabe',
			'--expected-release', 'release-2026.02.25.13',
			'--expected-channel', 'stable',
			'--max-evidence-age-hours', '24',
			'--now', '2026-02-25T12:00:00Z',
		]);
		assert.notStrictEqual(result.status, 0, 'validator should fail on retention policy violations');
		assert.match(result.stderr, /ops logs retention policy must be >= 30d/i);
		assert.match(result.stderr, /per-release evidence must be retained\/present/i);
	});
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}
