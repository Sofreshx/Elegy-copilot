#!/usr/bin/env node
'use strict';
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EXECUTION_VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack-execution.js');
const LEGACY_VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack.js');
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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planpack-evidence-test-'));
	const filePath = path.join(dir, 'plan.md');
	try {
		fs.writeFileSync(filePath, content, 'utf8');
		fn(filePath);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
function runValidator(filePath, args = []) {
	return childProcess.spawnSync(process.execPath, [EXECUTION_VALIDATOR_PATH, filePath, ...args], {
		encoding: 'utf8',
		stdio: 'pipe',
	});
}
function runLegacyValidator(filePath, args = []) {
	return childProcess.spawnSync(process.execPath, [LEGACY_VALIDATOR_PATH, filePath, ...args], {
		encoding: 'utf8',
		stdio: 'pipe',
	});
}
function buildPlanPack({
	withVersion = true,
	planPackVersion = 1,
	workUnitGroupRows = [],
	streamRows = [],
	checkpointRows = [],
	executionLogLines = [],
	includeStreamEvidenceSection = true,
	finalGateRows = [],
	trustedEvidenceRows = [],
	retentionRows = [],
}) {
	const versionLine = withVersion ? `<!-- IE_PLAN_PACK_VERSION: ${planPackVersion} -->\n` : '';
	const defaultReleaseTag = 'release-2026.02.25.1';
	const defaultTimestamp = new Date().toISOString();
	const groupsOverviewRows = workUnitGroupRows.length > 0
		? workUnitGroupRows
		: [
			{ group: 'G-01', title: 'Foundation', status: 'in-progress', dependsOn: '—' },
			{ group: 'G-02', title: 'Stream 2', status: 'not-started', dependsOn: 'G-01' },
			{ group: 'G-03', title: 'Stream 3', status: 'not-started', dependsOn: 'G-01' },
			{ group: 'G-04', title: 'Stream 4', status: 'not-started', dependsOn: 'G-01' },
		];
	const checkpointTableRows = checkpointRows.length > 0
		? checkpointRows.map(row => `| ${row.group} | ${row.checkpoint} | ${row.trigger} | ${row.notes} |`).join('\n')
		: '| G-01 | unit-tests | after group completion | status: pending |';
	const streamEvidenceBlock = includeStreamEvidenceSection
		? `
## Stream Evidence
| Group | Predicate | Evidence | Status | Notes |
| --- | --- | --- | --- | --- |
${streamRows.map(row => `| ${row.group} | ${row.predicate || 'execution-log and/or stream-marker'} | ${row.evidence || ''} | ${row.status} | ${row.notes || ''} |`).join('\n')}
`
		: '';
	const executionLog = executionLogLines.length > 0
		? executionLogLines.map(line => `- ${line}`).join('\n')
		: '- 2026-02-25T00:00:00Z — Session initialized';
	const finalGateTableRows = finalGateRows.length > 0
		? finalGateRows
		: [
			{ control: 'evidencePredicates', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'all required stream checks satisfied' },
			{ control: 'finalGateWaiverPrecedence', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'per-control waiver precedence active' },
			{ control: 'trustedEvidenceBindingRetention', status: 'passed', waiverScope: '', waiverRelease: '', waiverAudit: '', notes: 'evidence bindings retained' },
		];
	const trustedRows = trustedEvidenceRows.length > 0
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
	const retentionPolicyRows = retentionRows.length > 0
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
	return `# Plan Pack — Evidence Predicate Test
${versionLine}## Goal + Success Criteria
- Goal: Validate evidence predicates.
- Success Criteria:
  - Validator enforces required streams for versioned plans.
## Context Loaded (exact files)
- scripts/validate-planpack-execution.js
- scripts/validate-planpack.js
## Assumptions + Constraints
- Keep checks deterministic.
## Decisions (with rationale)
- Enforce stream evidence for G-01..G-04.
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
- Ensure schema checks are valid before evidence predicate checks run.
#### Acceptance Criteria
- Validator accepts structurally valid planpack.
- Evidence enforcement is deterministic for required streams.
#### Plan / Approach
- Keep a minimal, valid WU spec and graph.
#### Expected Files (optional)
- scripts/validate-planpack.js (modify)
#### Validation
- Run validate-planpack-execution.js against sample content.
## Execution Notes
- Progress updates live in the progress tracker section.
## Risks / Rollback
- Risk: false negatives in evidence matching.
## Validation
- node scripts/validate-planpack-execution.js <planpack>
# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
## Session Metadata
- Session ID: 20260225_000000_TEST
- Date: 2026-02-25
- Owner: test
- Plan Pack: ~/.elegy/session-state/20260225_000000_TEST/plan.md
## Work Unit Groups Overview
| Group | Title | Status | Depends On |
| --- | --- | --- | --- |
${groupsOverviewRows.map((row) => `| ${row.group} | ${row.title || ''} | ${row.status || 'not-started'} | ${row.dependsOn || '—'} |`).join('\n')}
## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | — | baseline complete |
## Next Unit
**WU-002** — continue evidence verification
## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
${checkpointTableRows}
${streamEvidenceBlock}
## Final Gate Controls
| Control | Status | Waiver Scope | Waiver Release | Waiver Audit | Notes |
| --- | --- | --- | --- | --- | --- |
${finalGateTableRows.map(row => `| ${row.control} | ${row.status} | ${row.waiverScope || ''} | ${row.waiverRelease || ''} | ${row.waiverAudit || ''} | ${row.notes || ''} |`).join('\n')}
## Trusted Evidence Binding
| Commit SHA | Release Tag | Channel | Producer Identity | Attestation Status | Evidence Timestamp | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
${trustedRows.map(row => `| ${row.commitSha || ''} | ${row.releaseTag || ''} | ${row.channel || ''} | ${row.producerIdentity || ''} | ${row.attestationStatus || ''} | ${row.evidenceTimestamp || ''} | ${row.evidence || ''} | ${row.notes || ''} |`).join('\n')}
## Evidence Retention
| Policy | Retention Days | Retained | Release Tag | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
${retentionPolicyRows.map(row => `| ${row.policy || ''} | ${row.retentionDays || ''} | ${row.retained || ''} | ${row.releaseTag || ''} | ${row.evidence || ''} | ${row.notes || ''} |`).join('\n')}
## Execution Log
${executionLog}
`;
}
test('fails deterministically when any required stream evidence is missing', () => {
	const planContent = buildPlanPack({
		withVersion: true,
		streamRows: [
			{ group: 'G-01', status: 'passed', evidence: 'attestation://g01', notes: 'status: passed' },
			{ group: 'G-02', status: 'passed', evidence: 'attestation://g02', notes: 'status: passed' },
			{ group: 'G-03', status: 'passed', evidence: 'attestation://g03', notes: 'status: passed' },
			{ group: 'G-04', status: 'pending', evidence: '', notes: 'status: pending' },
		],
		executionLogLines: ['2026-02-25T10:00:00Z — G-01 completed (status: passed)'],
	});
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0, 'validator should fail when G-04 evidence is missing');
		assert.match(result.stderr, /missing required stream evidence: G-04/i);
	});
});
test('fails when Work Unit Groups Overview includes an additional stream without evidence coverage', () => {
	const planContent = buildPlanPack({
		withVersion: true,
		workUnitGroupRows: [
			{ group: 'G-01', title: 'Foundation', status: 'done', dependsOn: '—' },
			{ group: 'G-02', title: 'Stream 2', status: 'done', dependsOn: 'G-01' },
			{ group: 'G-03', title: 'Stream 3', status: 'done', dependsOn: 'G-01' },
			{ group: 'G-04', title: 'Stream 4', status: 'done', dependsOn: 'G-01' },
			{ group: 'G-05', title: 'Stream 5', status: 'done', dependsOn: 'G-01' },
		],
		streamRows: [
			{ group: 'G-01', status: 'passed', evidence: 'attestation://g01', notes: 'status: passed' },
			{ group: 'G-02', status: 'passed', evidence: 'attestation://g02', notes: 'status: passed' },
			{ group: 'G-03', status: 'passed', evidence: 'attestation://g03', notes: 'status: passed' },
			{ group: 'G-04', status: 'passed', evidence: 'attestation://g04', notes: 'status: passed' },
		],
		executionLogLines: [
			'2026-02-25T10:00:00Z — G-01 completed (status: passed)',
			'2026-02-25T10:10:00Z — G-02 completed (status: passed)',
			'2026-02-25T10:20:00Z — G-03 completed (status: passed)',
			'2026-02-25T10:30:00Z — G-04 completed (status: passed)',
		],
	});
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0, 'validator should fail when derived stream G-05 evidence is missing');
		assert.match(result.stderr, /missing required stream evidence: G-05/i);
	});
});
test('passes when both Stream Evidence rows and Execution Log contain required G-01..G-04 evidence', () => {
	const planContent = buildPlanPack({
		withVersion: true,
		streamRows: [
			{ group: 'G-01', status: 'passed', evidence: 'attestation://g01', notes: 'status: passed' },
			{ group: 'G-02', status: 'passed', evidence: 'attestation://g02', notes: 'status: passed' },
			{ group: 'G-03', status: 'passed', evidence: 'attestation://g03', notes: 'status: passed' },
			{ group: 'G-04', status: 'passed', evidence: 'attestation://g04', notes: 'status: passed' },
		],
		executionLogLines: [
			'2026-02-25T10:00:00Z — G-01 completed (status: passed)',
			'2026-02-25T10:10:00Z — G-02 completed (status: passed)',
			'2026-02-25T10:20:00Z — G-03 completed (status: passed)',
			'2026-02-25T10:30:00Z — G-04 completed (status: passed)',
		],
	});
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.strictEqual(result.status, 0, `validator should pass, stderr: ${result.stderr}`);
		assert.match(result.stdout, /planpack ok \(1 work units\)/i);
	});
});
test('fails when execution log has completion entries but stream evidence rows are not passed with evidence refs', () => {
	const planContent = buildPlanPack({
		withVersion: true,
		streamRows: [
			{ group: 'G-01', status: 'pending', evidence: '', notes: 'status: pending' },
			{ group: 'G-02', status: 'pending', evidence: '', notes: 'status: pending' },
			{ group: 'G-03', status: 'pending', evidence: '', notes: 'status: pending' },
			{ group: 'G-04', status: 'pending', evidence: '', notes: 'status: pending' },
		],
		executionLogLines: [
			'2026-02-25T10:00:00Z — G-01 completed (status: passed)',
			'2026-02-25T10:10:00Z — G-02 completed (status: passed)',
			'2026-02-25T10:20:00Z — G-03 done',
			'2026-02-25T10:30:00Z — G-04 completed',
		],
	});
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0, 'validator should fail without stream evidence refs/status');
		assert.match(result.stderr, /missing required stream evidence: G-01/i);
	});
});
test('fails closed when no planpack version marker exists', () => {
	const planContent = buildPlanPack({
		withVersion: false,
		streamRows: [],
		includeStreamEvidenceSection: false,
		executionLogLines: [],
	});
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0, 'validator should fail closed without version marker');
		assert.match(result.stderr, /missing required version marker/i);
	});
});
test('supports explicit migration-only legacy best-effort override for unversioned planpacks', () => {
	const planContent = buildPlanPack({
		withVersion: false,
		streamRows: [],
		includeStreamEvidenceSection: false,
		executionLogLines: [],
	});
	withTempPlanFile(planContent, (filePath) => {
		const result = runLegacyValidator(filePath, ['--allow-legacy-best-effort']);
		assert.strictEqual(result.status, 0, `validator should allow legacy override, stderr: ${result.stderr}`);
		assert.match(result.stderr, /migration-only compatibility entrypoint/i);
		assert.match(result.stderr, /migration-only legacy best-effort override active/i);
	});
});
test('fails closed for unsupported planpack version marker values', () => {
	const planContent = buildPlanPack({
		withVersion: true,
		planPackVersion: 2,
		streamRows: [
			{ group: 'G-01', status: 'passed', evidence: 'attestation://g01', notes: 'status: passed' },
			{ group: 'G-02', status: 'passed', evidence: 'attestation://g02', notes: 'status: passed' },
			{ group: 'G-03', status: 'passed', evidence: 'attestation://g03', notes: 'status: passed' },
			{ group: 'G-04', status: 'passed', evidence: 'attestation://g04', notes: 'status: passed' },
		],
		executionLogLines: [
			'2026-02-25T10:00:00Z — G-01 completed (status: passed)',
			'2026-02-25T10:10:00Z — G-02 completed (status: passed)',
			'2026-02-25T10:20:00Z — G-03 completed (status: passed)',
			'2026-02-25T10:30:00Z — G-04 completed (status: passed)',
		],
	});
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0, 'validator should fail for unsupported version marker');
		assert.match(result.stderr, /unsupported planpack version: 2/i);
	});
});
console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}
