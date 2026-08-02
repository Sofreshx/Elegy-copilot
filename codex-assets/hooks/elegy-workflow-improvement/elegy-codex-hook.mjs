#!/usr/bin/env node

import crypto from 'crypto';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCHEMA_VERSION = 1;
const CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const QUEUE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const QUEUE_LEASE_MS = 30 * 60 * 1000;
const MAX_STORED_CHECKPOINT_BYTES = 6 * 1024;
const MAX_STORED_GOAL_FRAME_BYTES = 16 * 1024;
const MAX_INJECTED_CHECKPOINT_TOKENS = 1500;
const MAX_TELEMETRY_EVENTS = 100;
const MAX_STORED_RECEIPT_BYTES = 24 * 1024;
const MAX_RECEIPT_FILES_TO_INSPECT = 24;
const MAX_RECENT_RECEIPTS = 3;
const MAX_SUBAGENT_START_CONTEXT_TOKENS = 600;
const MAX_ATTENTION_SIGNALS = 12;
const MAX_SIGNAL_ID_LENGTH = 96;
const MAX_SIGNAL_KEY_LENGTH = 96;
const MAX_SIGNAL_TEXT_LENGTH = 512;
const MAX_SIGNAL_EVIDENCE_REFS = 8;
const MAX_SIGNAL_EVIDENCE_REF_LENGTH = 256;
const MAX_STORED_CHECKPOINT_V2_BYTES = 18 * 1024;
const MAX_CHECKPOINT_HISTORY = 64;
const ASSURANCE_MODES = ['normal', 'advisory', 'strict'];
const ASSURANCE_STATUSES = ['not-requested', 'suggested', 'requested', 'passed', 'blocked', 'stale'];
const ATTENTION_SEVERITIES = ['critical', 'high', 'medium', 'low'];
const ATTENTION_STATUSES = ['open', 'accepted', 'resolved', 'stale'];
const VALIDATION_RECEIPT_KINDS = ['command', 'test', 'build', 'lint', 'manual', 'other'];
const VALIDATION_RECEIPT_STATUSES = ['pending', 'passed', 'failed', 'blocked', 'skipped'];
const BLOCKER_RECORD_STATUSES = ['open', 'accepted', 'resolved'];
const EXTERNAL_GATE_RECORD_STATUSES = ['pending', 'passed', 'failed', 'waived', 'unavailable'];
const CHECKPOINT_FIELDS = [
  'schemaVersion',
  'goalId',
  'phase',
  'completedWaveIds',
  'activeWaveId',
  'decisions',
  'repositoryHeads',
  'validationEvidence',
  'blockers',
  'externalGates',
  'nextAction',
  'updatedAt',
];
const CHECKPOINT_V2_FIELDS = [
  'schemaVersion',
  'goalId',
  'phase',
  'planning',
  'completedWaveIds',
  'activeWaveId',
  'decisions',
  'repositories',
  'validationEvidence',
  'blockers',
  'externalGates',
  'nextAction',
  'resume',
  'gitCheckpoint',
  'updatedAt',
];
const GOAL_FRAME_FIELDS = [
  'schemaVersion',
  'kind',
  'goalId',
  'successCriteria',
  'canonicalAuthority',
  'planning',
  'repositories',
  'dependencyWaves',
  'integrationOwner',
  'readiness',
  'validation',
  'stopEscalationContinuation',
  'checkpointPolicy',
  'retrospectiveEligibility',
];
const AGENT_RESULT_FIELDS = [
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
  'payload',
];
const MANAGED_SUBAGENT_TYPES = new Set([
  'explorer',
  'reviewer',
  'reviewer_strong',
  'worker',
  'test-runner',
  'sweeper',
]);
const PAYLOAD_KIND_BY_AGENT_TYPE = new Map([
  ['explorer', 'exploration'],
  ['reviewer', 'review'],
  ['reviewer_strong', 'strongReview'],
  ['worker', 'implementation'],
  ['test-runner', 'testRun'],
  ['sweeper', 'cleanup'],
]);

function now() {
  return new Date();
}

function nowIso() {
  return now().toISOString();
}

function defaultRoot() {
  return process.env.ELEGY_CODEX_WORKFLOW_HOME
    ? path.resolve(process.env.ELEGY_CODEX_WORKFLOW_HOME)
    : path.join(os.homedir(), '.elegy', 'codex-workflow-improvement');
}

function safeCanonicalThreadId(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(normalized) ? normalized : '';
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function sessionDirectory(root, canonicalThreadId) {
  return path.join(root, 'sessions', canonicalThreadId);
}

function receiptDirectory(root, canonicalThreadId) {
  return path.join(sessionDirectory(root, canonicalThreadId), 'receipts');
}

function checkpointHistoryDirectory(root, canonicalThreadId) {
  return path.join(sessionDirectory(root, canonicalThreadId), 'checkpoints');
}

function getVerifiedBinding(root, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  const bindings = readJson(path.join(root, 'bindings.json'), { bindings: {} });
  const binding = bindings?.bindings?.[sessionId];
  const canonicalThreadId = safeCanonicalThreadId(binding?.canonicalThreadId);
  if (!binding || binding.verified !== true || !canonicalThreadId || typeof binding.verificationReceipt !== 'string' || !binding.verificationReceipt.trim()) {
    return null;
  }
  return { canonicalThreadId, sessionId };
}

function redact(text) {
  return String(text)
    .replace(/\b(sk-(?:proj-)?)[A-Za-z0-9_-]{8,}\b/g, '$1[REDACTED]')
    .replace(/\b(ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}\b/g, '$1[REDACTED]')
    .replace(/\b(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*([:=])\s*[^\s]+/gi, '$1$2[REDACTED]');
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNullableNonEmptyString(value) {
  return value === null || (typeof value === 'string' && value.trim().length > 0);
}

function hasExactKeys(value, fields, optionalFields = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...fields, ...optionalFields]);
  return keys.every((key) => allowed.has(key)) && fields.every((field) => keys.includes(field));
}

function isAssurancePolicy(value) {
  return normalizeAssurancePolicy(value) !== null;
}

function isAttentionSignals(value) {
  if (!Array.isArray(value) || value.length > MAX_ATTENTION_SIGNALS) return false;
  const signalIds = new Set();
  for (const signal of value) {
    const evidenceRefs = Array.isArray(signal?.evidenceRefs)
      ? [...new Set(signal.evidenceRefs.map((entry) => typeof entry === 'string' ? entry.trim() : entry))]
      : null;
    if (!hasExactKeys(signal, ['signalId', 'signalKey', 'severity', 'summary', 'evidenceRefs', 'whyItMatters', 'whenToRevisit', 'status'])
      || !boundedStringIsValid(signal.signalId, MAX_SIGNAL_ID_LENGTH)
      || !boundedStringIsValid(signal.signalKey, MAX_SIGNAL_KEY_LENGTH)
      || !boundedStringIsValid(signal.summary, MAX_SIGNAL_TEXT_LENGTH)
      || !boundedStringIsValid(signal.whyItMatters, MAX_SIGNAL_TEXT_LENGTH)
      || !boundedStringIsValid(signal.whenToRevisit, MAX_SIGNAL_TEXT_LENGTH)
      || !ATTENTION_SEVERITIES.includes(signal.severity)
      || !ATTENTION_STATUSES.includes(signal.status)
      || !evidenceRefs
      || evidenceRefs.length === 0
      || evidenceRefs.length > MAX_SIGNAL_EVIDENCE_REFS
      || !evidenceRefs.every((entry) => boundedStringIsValid(entry, MAX_SIGNAL_EVIDENCE_REF_LENGTH))) return false;
    const normalizedSignalId = signal.signalId.trim();
    if (signalIds.has(normalizedSignalId)) return false;
    signalIds.add(normalizedSignalId);
  }
  return true;
}

function boundedStringIsValid(value, maximumLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximumLength;
}

function normalizeAttentionSignals(value) {
  if (!isAttentionSignals(value)) return null;
  return value.map((signal) => ({
    ...signal,
    signalId: signal.signalId.trim(),
    signalKey: signal.signalKey.trim(),
    summary: signal.summary.trim(),
    evidenceRefs: [...new Set(signal.evidenceRefs.map((entry) => entry.trim()))],
    whyItMatters: signal.whyItMatters.trim(),
    whenToRevisit: signal.whenToRevisit.trim(),
  }));
}

function isNullableInteger(value, minimum = null) {
  return value === null || (Number.isInteger(value) && (minimum === null || value >= minimum));
}

function isValidationReceipts(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  for (const receipt of value) {
    if (!hasExactKeys(receipt, ['receiptId', 'check', 'kind', 'status', 'command', 'exitCode', 'durationMs', 'artifactRef', 'observedAt', 'headRef'])
      || !boundedStringIsValid(receipt.receiptId, 128)
      || !boundedStringIsValid(receipt.check, 512)
      || !VALIDATION_RECEIPT_KINDS.includes(receipt.kind)
      || !VALIDATION_RECEIPT_STATUSES.includes(receipt.status)
      || !isNullableNonEmptyString(receipt.command)
      || !isNullableInteger(receipt.exitCode)
      || !isNullableInteger(receipt.durationMs, 0)
      || !isNullableNonEmptyString(receipt.artifactRef)
      || typeof receipt.observedAt !== 'string'
      || Number.isNaN(Date.parse(receipt.observedAt))
      || !isNullableNonEmptyString(receipt.headRef)
      || ids.has(receipt.receiptId.trim())) return false;
    ids.add(receipt.receiptId.trim());
  }
  return true;
}

function isBlockerRecords(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  for (const record of value) {
    if (!hasExactKeys(record, ['blockerId', 'code', 'severity', 'owner', 'blocking', 'status', 'evidenceRefs', 'nextDecision'])
      || !boundedStringIsValid(record.blockerId, 128)
      || !boundedStringIsValid(record.code, 128)
      || !ATTENTION_SEVERITIES.includes(record.severity)
      || !boundedStringIsValid(record.owner, 256)
      || typeof record.blocking !== 'boolean'
      || !BLOCKER_RECORD_STATUSES.includes(record.status)
      || !isStringArray(record.evidenceRefs)
      || !isNullableNonEmptyString(record.nextDecision)
      || ids.has(record.blockerId.trim())) return false;
    ids.add(record.blockerId.trim());
  }
  return true;
}

function isExternalGateRecords(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  for (const record of value) {
    if (!hasExactKeys(record, ['gateId', 'owner', 'blocking', 'status', 'evidenceRefs', 'continueWhen'])
      || !boundedStringIsValid(record.gateId, 128)
      || !boundedStringIsValid(record.owner, 256)
      || typeof record.blocking !== 'boolean'
      || !EXTERNAL_GATE_RECORD_STATUSES.includes(record.status)
      || !isStringArray(record.evidenceRefs)
      || !isNullableNonEmptyString(record.continueWhen)
      || ids.has(record.gateId.trim())) return false;
    ids.add(record.gateId.trim());
  }
  return true;
}

function normalizeAssurancePolicy(value) {
  if (!hasExactKeys(value, ['mode', 'verificationStatus'], ['gateRef', 'evidenceRefs', 'decisionRef'])
    || !ASSURANCE_MODES.includes(value.mode)
    || !ASSURANCE_STATUSES.includes(value.verificationStatus)) return null;
  const gateRef = value.gateRef === undefined || value.gateRef === null ? null : value.gateRef;
  const evidenceRefs = value.evidenceRefs === undefined ? [] : value.evidenceRefs;
  const decisionRef = value.decisionRef === undefined || value.decisionRef === null ? null : value.decisionRef;
  if ((gateRef !== null && !boundedStringIsValid(gateRef, MAX_SIGNAL_EVIDENCE_REF_LENGTH))
    || (decisionRef !== null && !boundedStringIsValid(decisionRef, MAX_SIGNAL_EVIDENCE_REF_LENGTH))
    || !Array.isArray(evidenceRefs)
    || evidenceRefs.length > MAX_SIGNAL_EVIDENCE_REFS
    || evidenceRefs.some((entry) => !boundedStringIsValid(entry, MAX_SIGNAL_EVIDENCE_REF_LENGTH))) return null;
  const normalized = {
    mode: value.mode,
    verificationStatus: value.verificationStatus,
    gateRef: gateRef === null ? null : gateRef.trim(),
    evidenceRefs: evidenceRefs.map((entry) => String(entry).trim()),
    decisionRef: decisionRef === null ? null : decisionRef.trim(),
  };
  if (normalized.mode === 'normal'
    && (normalized.verificationStatus !== 'not-requested' || normalized.gateRef || normalized.evidenceRefs.length || normalized.decisionRef)) return null;
  if (normalized.mode === 'strict' && !['requested', 'passed', 'blocked', 'stale'].includes(normalized.verificationStatus)) return null;
  if (normalized.mode === 'strict' && !normalized.gateRef) return null;
  if (normalized.mode === 'strict' && ['passed', 'blocked'].includes(normalized.verificationStatus) && normalized.evidenceRefs.length === 0) return null;
  if (normalized.mode === 'strict' && normalized.verificationStatus === 'blocked' && !normalized.decisionRef) return null;
  return normalized;
}

function normalizeDynamicFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const normalized = { ...value };
  if (normalized.assurancePolicy !== undefined) {
    normalized.assurancePolicy = normalizeAssurancePolicy(normalized.assurancePolicy);
  }
  if (normalized.attentionSignals !== undefined) {
    normalized.attentionSignals = normalizeAttentionSignals(normalized.attentionSignals);
  }
  return normalized;
}

function isPlanningRefs(value) {
  if (!hasExactKeys(value, ['surface', 'scopeKey', 'goalRef', 'roadmapRef', 'planRef', 'workPointRefs', 'projectRunRef', 'authorityStatus'])) return false;
  if (!['none', 'plan-pack', 'roadmap', 'both'].includes(value.surface)) return false;
  if (!isNullableNonEmptyString(value.scopeKey)
    || !isNullableNonEmptyString(value.goalRef)
    || !isNullableNonEmptyString(value.roadmapRef)
    || !isNullableNonEmptyString(value.planRef)
    || !isNullableNonEmptyString(value.projectRunRef)
    || !['resolved', 'manual', 'required', 'unavailable'].includes(value.authorityStatus)
    || !isStringArray(value.workPointRefs)) return false;
  if (value.surface !== 'none' && !value.scopeKey) return false;
  if ((value.surface === 'roadmap' || value.surface === 'both') && (!value.goalRef || !value.roadmapRef || !value.planRef)) return false;
  return true;
}

function isRepositoryState(value) {
  return hasExactKeys(value, ['repositoryId', 'branch', 'baseRef', 'headRef', 'worktreeStatus', 'ownedPaths', 'changedPaths', 'commitRef'])
    && ['repositoryId', 'branch', 'baseRef', 'headRef'].every((field) => typeof value[field] === 'string' && value[field].trim())
    && ['clean', 'dirty', 'unknown'].includes(value.worktreeStatus)
    && isStringArray(value.ownedPaths)
    && isStringArray(value.changedPaths)
    && isNullableNonEmptyString(value.commitRef);
}

function isGoalFrameRepositoryList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isRepositoryState)
    && new Set(value.map((entry) => entry.repositoryId)).size === value.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function planningRefsCompatible(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function goalRunRecordsCompatible(frame, checkpoint) {
  if (!frame || !checkpoint) return true;
  if (frame.goalId !== checkpoint.goalId || !planningRefsCompatible(frame.planning, checkpoint.planning)) return false;
  // A goal keeps one assurance mode, while its verification status may move from
  // suggested/requested to passed, blocked, or stale as evidence arrives. The
  // attention ledger is intentionally wave-scoped and may add, resolve, or
  // retire signals between checkpoints; each record is independently validated.
  if (frame.assurancePolicy && checkpoint.assurancePolicy
    && frame.assurancePolicy.mode !== checkpoint.assurancePolicy.mode) return false;
  const frameRepositoryIds = frame.repositories.map((repository) => repository.repositoryId).sort();
  const checkpointRepositoryIds = checkpoint.repositories.map((repository) => repository.repositoryId).sort();
  if (JSON.stringify(frameRepositoryIds) !== JSON.stringify(checkpointRepositoryIds)) return false;
  const frameWaveIds = new Set(frame.dependencyWaves.map((wave) => wave.waveId));
  if (checkpoint.activeWaveId && !frameWaveIds.has(checkpoint.activeWaveId)) return false;
  return checkpoint.completedWaveIds.every((waveId) => frameWaveIds.has(waveId));
}

function redactJson(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJson(entry)]));
  }
  return value;
}

function checkpointIsValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const schemaFields = value.schemaVersion === '2' ? CHECKPOINT_V2_FIELDS : CHECKPOINT_FIELDS;
  if (!hasExactKeys(value, schemaFields, value.schemaVersion === '2'
    ? ['assurancePolicy', 'attentionSignals', 'validationReceipts', 'blockerRecords', 'externalGateRecords']
    : [])) return false;
  if (!['1', '2'].includes(value.schemaVersion) || typeof value.goalId !== 'string' || !value.goalId.trim()) return false;
  if (!['planning', 'implementation', 'review', 'deployment'].includes(value.phase)) return false;
  if (value.activeWaveId !== null && (typeof value.activeWaveId !== 'string' || !value.activeWaveId.trim())) return false;
  if (!['completedWaveIds', 'decisions', 'validationEvidence', 'blockers', 'externalGates'].every((field) => isStringArray(value[field]))) return false;
  if (typeof value.nextAction !== 'string' || !value.nextAction.trim()) return false;
  if (Number.isNaN(Date.parse(value.updatedAt))) return false;
  if (value.schemaVersion === '1') {
    if (!isStringArray(value.repositoryHeads)) return false;
  } else {
    if (!isPlanningRefs(value.planning) || !isGoalFrameRepositoryList(value.repositories)) return false;
    if (!hasExactKeys(value.resume, ['status', 'checkedAt', 'drift'])
      || !['fresh', 'reconciled', 'drifted', 'blocked'].includes(value.resume.status)
      || !isNullableNonEmptyString(value.resume.checkedAt)
      || (value.resume.checkedAt && Number.isNaN(Date.parse(value.resume.checkedAt)))
      || !isStringArray(value.resume.drift)) return false;
    if (!hasExactKeys(value.gitCheckpoint, ['status', 'commitSha', 'reason', 'validationRefs'])
      || !['not-applicable', 'committed', 'clean-no-commit', 'blocked-uncommitted'].includes(value.gitCheckpoint.status)
      || !isNullableNonEmptyString(value.gitCheckpoint.commitSha)
      || !isNullableNonEmptyString(value.gitCheckpoint.reason)
      || !isStringArray(value.gitCheckpoint.validationRefs)) return false;
    if (value.gitCheckpoint.status === 'committed' && !value.gitCheckpoint.commitSha) return false;
    if ((value.assurancePolicy !== undefined && !isAssurancePolicy(value.assurancePolicy))
      || (value.attentionSignals !== undefined && !isAttentionSignals(value.attentionSignals))
      || (value.validationReceipts !== undefined && !isValidationReceipts(value.validationReceipts))
      || (value.blockerRecords !== undefined && !isBlockerRecords(value.blockerRecords))
      || (value.externalGateRecords !== undefined && !isExternalGateRecords(value.externalGateRecords))) return false;
  }
  const maximumBytes = value.schemaVersion === '2' ? MAX_STORED_CHECKPOINT_V2_BYTES : MAX_STORED_CHECKPOINT_BYTES;
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maximumBytes;
}

function extractCheckpoint(lastAssistantMessage) {
  if (typeof lastAssistantMessage !== 'string') return null;
  const marker = /(?:^|\r?\n)SESSION_CHECKPOINT\s*\r?\n```json\s*\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/g;
  const matches = [...lastAssistantMessage.matchAll(marker)];
  if (matches.length !== 1) return null;
  try {
    const checkpoint = normalizeDynamicFields(redactJson(JSON.parse(matches[0][1])));
    return checkpointIsValid(checkpoint) ? checkpoint : null;
  } catch {
    return null;
  }
}

function dependencyWavesAreValid(waves) {
  const waveIds = new Set(waves.map((wave) => wave.waveId));
  if (waves.some((wave) => wave.dependsOn.includes(wave.waveId) || wave.dependsOn.some((dependency) => !waveIds.has(dependency)))) return false;
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(waves.map((wave) => [wave.waveId, wave]));
  const visit = (waveId) => {
    if (visiting.has(waveId)) return false;
    if (visited.has(waveId)) return true;
    visiting.add(waveId);
    for (const dependency of byId.get(waveId).dependsOn) if (!visit(dependency)) return false;
    visiting.delete(waveId);
    visited.add(waveId);
    return true;
  };
  return waves.every((wave) => visit(wave.waveId));
}

function goalFrameIsValid(value) {
  if (!hasExactKeys(value, GOAL_FRAME_FIELDS, ['assurancePolicy', 'attentionSignals']) || value.schemaVersion !== '1' || value.kind !== 'goal-session.frame') return false;
  if (typeof value.goalId !== 'string' || !value.goalId.trim() || !isStringArray(value.successCriteria) || !value.successCriteria.length) return false;
  if (typeof value.canonicalAuthority !== 'string' || !value.canonicalAuthority.trim() || !isPlanningRefs(value.planning)) return false;
  if (!isGoalFrameRepositoryList(value.repositories)) return false;
  if (!Array.isArray(value.dependencyWaves) || !value.dependencyWaves.length) return false;
  const waveIds = new Set();
  for (const wave of value.dependencyWaves) {
    if (!hasExactKeys(wave, ['waveId', 'dependsOn', 'status', 'workPointRef', 'planRef', 'projectRunRef'])
      || typeof wave.waveId !== 'string' || !wave.waveId.trim()
      || !isStringArray(wave.dependsOn)
      || !['pending', 'active', 'completed', 'blocked', 'skipped'].includes(wave.status)
      || !isNullableNonEmptyString(wave.workPointRef)
      || !isNullableNonEmptyString(wave.planRef)
      || !isNullableNonEmptyString(wave.projectRunRef)
      || waveIds.has(wave.waveId)) return false;
    waveIds.add(wave.waveId);
  }
  if (!dependencyWavesAreValid(value.dependencyWaves)) return false;
  if (typeof value.integrationOwner !== 'string' || !value.integrationOwner.trim()) return false;
  if (!hasExactKeys(value.readiness, ['codeReadiness', 'environmentReadiness'])
    || !isStringArray(value.readiness.codeReadiness) || !isStringArray(value.readiness.environmentReadiness)) return false;
  if (!Array.isArray(value.validation) || value.validation.some((entry) => !hasExactKeys(entry, ['waveId', 'owner', 'expectedEvidence', 'status'])
    || !isNullableNonEmptyString(entry.waveId) || typeof entry.owner !== 'string' || !entry.owner.trim()
    || !isStringArray(entry.expectedEvidence) || !['pending', 'passed', 'failed', 'blocked'].includes(entry.status)
    || (entry.waveId !== null && !waveIds.has(entry.waveId)))) return false;
  if (!hasExactKeys(value.stopEscalationContinuation, ['stop', 'escalate', 'continueWhen'])
    || !isStringArray(value.stopEscalationContinuation.stop)
    || !isStringArray(value.stopEscalationContinuation.escalate)
    || !isStringArray(value.stopEscalationContinuation.continueWhen)) return false;
  if (!hasExactKeys(value.checkpointPolicy, ['beforeFanOut', 'afterEachWave', 'beforePhaseTransition'])
    || value.checkpointPolicy.beforeFanOut !== true
    || value.checkpointPolicy.afterEachWave !== true
    || value.checkpointPolicy.beforePhaseTransition !== true) return false;
  if ((value.assurancePolicy !== undefined && !isAssurancePolicy(value.assurancePolicy))
    || (value.attentionSignals !== undefined && !isAttentionSignals(value.attentionSignals))) return false;
  return ['manual_after_closure', 'not_eligible'].includes(value.retrospectiveEligibility)
    && Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_STORED_GOAL_FRAME_BYTES;
}

function extractGoalFrame(lastAssistantMessage) {
  if (typeof lastAssistantMessage !== 'string') return null;
  const marker = /(?:^|\r?\n)GOAL_SESSION_FRAME\s*\r?\n```json\s*\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/g;
  const matches = [...lastAssistantMessage.matchAll(marker)];
  if (matches.length !== 1) return null;
  try {
    const frame = normalizeDynamicFields(redactJson(JSON.parse(matches[0][1])));
    return goalFrameIsValid(frame) ? frame : null;
  } catch {
    return null;
  }
}

function saveGoalFrame(root, binding, frame) {
  const createdAt = now();
  const value = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-goal-session-frame',
    canonicalThreadId: binding.canonicalThreadId,
    codexSessionId: binding.sessionId,
    frame,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + CHECKPOINT_TTL_MS).toISOString(),
  };
  atomicWriteJson(path.join(sessionDirectory(root, binding.canonicalThreadId), 'goal-session.json'), value);
  return value;
}

function readValidGoalFrame(root, binding) {
  const frame = readJson(path.join(sessionDirectory(root, binding.canonicalThreadId), 'goal-session.json'), null);
  if (!frame || frame.schemaVersion !== SCHEMA_VERSION || frame.kind !== 'codex-goal-session-frame') return null;
  if (frame.canonicalThreadId !== binding.canonicalThreadId || frame.codexSessionId !== binding.sessionId) return null;
  const normalizedFrame = normalizeDynamicFields(frame.frame);
  if (!goalFrameIsValid(normalizedFrame)) return null;
  if (Number.isNaN(Date.parse(frame.expiresAt)) || Date.parse(frame.expiresAt) <= now().getTime()) return null;
  return { ...frame, frame: normalizedFrame };
}

function validCheckpointEnvelope(value, binding) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || value.kind !== 'codex-session-checkpoint') return false;
  if (value.canonicalThreadId !== binding.canonicalThreadId || value.codexSessionId !== binding.sessionId) return false;
  const hasOrdering = value.checkpointId !== undefined || value.sequence !== undefined || value.previousCheckpointId !== undefined;
  if (hasOrdering && (!safeCanonicalThreadId(value.checkpointId)
    || !Number.isInteger(value.sequence) || value.sequence < 1
    || (value.previousCheckpointId !== null && !safeCanonicalThreadId(value.previousCheckpointId)))) return false;
  const normalizedCheckpoint = normalizeDynamicFields(value.checkpoint);
  if (!checkpointIsValid(normalizedCheckpoint)) return false;
  if (Number.isNaN(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now().getTime()) return false;
  return true;
}

function pruneCheckpointHistory(root, binding) {
  const directory = checkpointHistoryDirectory(root, binding.canonicalThreadId);
  let entries;
  try {
    entries = fs.readdirSync(directory)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => {
        const filePath = path.join(directory, entry);
        return { filePath, value: readJson(filePath, null) };
      });
  } catch {
    return;
  }
  const retained = entries
    .filter(({ value }) => validCheckpointEnvelope(value, binding))
    .sort((left, right) => Date.parse(right.value.createdAt) - Date.parse(left.value.createdAt));
  const retainedPaths = new Set(retained.slice(0, MAX_CHECKPOINT_HISTORY).map(({ filePath }) => filePath));
  for (const { filePath } of entries) {
    if (!retainedPaths.has(filePath)) fs.rmSync(filePath, { force: true });
  }
}

function latestCheckpointHistoryForGoal(root, binding, goalId) {
  const directory = checkpointHistoryDirectory(root, binding.canonicalThreadId);
  let entries;
  try {
    entries = fs.readdirSync(directory)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readJson(path.join(directory, entry), null));
  } catch {
    return null;
  }
  return entries
    .filter((value) => validCheckpointEnvelope(value, binding)
      && value.checkpoint.goalId === goalId
      && Number.isInteger(value.sequence))
    .sort((left, right) => right.sequence - left.sequence)[0] || null;
}

function saveCheckpoint(root, binding, checkpoint, reconciliation = null) {
  const createdAt = now();
  const current = readJson(path.join(sessionDirectory(root, binding.canonicalThreadId), 'checkpoint.json'), null);
  const currentGoalCheckpoint = validCheckpointEnvelope(current, binding) && current.checkpoint.goalId === checkpoint.goalId
    ? current
    : latestCheckpointHistoryForGoal(root, binding, checkpoint.goalId);
  const continuesCurrentGoal = Boolean(currentGoalCheckpoint);
  const previousSequence = continuesCurrentGoal && Number.isInteger(currentGoalCheckpoint.sequence) ? currentGoalCheckpoint.sequence : 0;
  const sequence = previousSequence + 1;
  const goalKey = crypto.createHash('sha256').update(checkpoint.goalId).digest('hex').slice(0, 10);
  const checkpointId = `cp-${goalKey}-${String(sequence).padStart(6, '0')}`;
  const value = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-session-checkpoint',
    canonicalThreadId: binding.canonicalThreadId,
    codexSessionId: binding.sessionId,
    checkpointId,
    sequence,
    previousCheckpointId: continuesCurrentGoal && currentGoalCheckpoint.checkpointId ? currentGoalCheckpoint.checkpointId : null,
    checkpoint,
    reconciliation: reconciliation ? redactJson(reconciliation) : null,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + CHECKPOINT_TTL_MS).toISOString(),
  };
  atomicWriteJson(path.join(checkpointHistoryDirectory(root, binding.canonicalThreadId), `${checkpointId}.json`), value);
  atomicWriteJson(path.join(sessionDirectory(root, binding.canonicalThreadId), 'checkpoint.json'), value);
  pruneCheckpointHistory(root, binding);
  return value;
}

function readValidCheckpoint(root, binding) {
  const checkpoint = readJson(path.join(sessionDirectory(root, binding.canonicalThreadId), 'checkpoint.json'), null);
  if (!validCheckpointEnvelope(checkpoint, binding)) return null;
  return { ...checkpoint, checkpoint: normalizeDynamicFields(checkpoint.checkpoint) };
}

function readGoalRunMetadata(root, binding) {
  const frame = readValidGoalFrame(root, binding);
  const checkpoint = readValidCheckpoint(root, binding);
  if (frame && checkpoint && !goalRunRecordsCompatible(frame.frame, checkpoint.checkpoint)) return null;
  const source = checkpoint?.checkpoint || frame?.frame;
  if (!source || !source.planning || !source.repositories) return null;
  const planning = source.planning;
  const repositories = source.repositories;
  const activeWaveId = checkpoint?.checkpoint.activeWaveId
    ?? frame?.frame.dependencyWaves.find((wave) => wave.status === 'active')?.waveId
    ?? null;
  const stableState = {
    goalId: source.goalId,
    planning,
    activeWaveId,
    repositories,
  };
  return {
    goalId: source.goalId,
    activeWaveId,
    checkpointRef: checkpoint?.checkpointId || checkpoint?.checkpoint.updatedAt || null,
    contextHash: crypto.createHash('sha256').update(canonicalJson(stableState)).digest('hex'),
  };
}

function estimateTokens(text) {
  // A three-byte-per-token estimate is deliberately conservative for ordinary
  // JSON text; it keeps injected hook context below the configured 1,500-token
  // limit without depending on an unavailable tokenizer at hook runtime.
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}

function shortenText(value, maximumBytes) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (Buffer.byteLength(text, 'utf8') <= maximumBytes) return text;
  let shortened = '';
  for (const character of text) {
    if (Buffer.byteLength(`${shortened}${character}…`, 'utf8') > maximumBytes) break;
    shortened += character;
  }
  return `${shortened}…`;
}

function compactAttentionSignals(signals, limit = 4) {
  const statusRank = { open: 0, accepted: 1, resolved: 2, stale: 3 };
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return (Array.isArray(signals) ? signals : [])
    .map((signal, index) => ({ signal, index }))
    .sort((left, right) => (statusRank[left.signal.status] - statusRank[right.signal.status])
      || (severityRank[left.signal.severity] - severityRank[right.signal.severity])
      || (left.index - right.index))
    .slice(0, limit)
    .map(({ signal }) => ({
    signalId: shortenText(signal.signalId, 96),
    signalKey: shortenText(signal.signalKey, 96),
    severity: signal.severity,
    summary: shortenText(signal.summary, 180),
    evidenceRefs: signal.evidenceRefs.slice(0, 3).map((entry) => shortenText(entry, 120)),
    whyItMatters: shortenText(signal.whyItMatters, 180),
    whenToRevisit: shortenText(signal.whenToRevisit, 140),
    status: signal.status,
    }));
}

function checkpointForInjection(checkpoint, maximumTokens = MAX_INJECTED_CHECKPOINT_TOKENS) {
  const compact = JSON.parse(JSON.stringify(checkpoint));
  const structuredArrayFields = ['validationReceipts', 'blockerRecords', 'externalGateRecords'];
  const arrayFields = compact.schemaVersion === '2'
    ? ['validationEvidence', 'decisions', 'externalGates', 'blockers', 'completedWaveIds']
    : ['validationEvidence', 'repositoryHeads', 'decisions', 'externalGates', 'blockers', 'completedWaveIds'];
  const contextFor = (serialized) => `Latest verified same-session checkpoint:\nSESSION_CHECKPOINT\n\`\`\`json\n${serialized}\n\`\`\``;
  if (compact.schemaVersion === '2') {
    if (compact.assurancePolicy) compact.assurancePolicy = { ...compact.assurancePolicy };
    if (Array.isArray(compact.attentionSignals)) compact.attentionSignals = compactAttentionSignals(compact.attentionSignals);
    compact.planning.scopeKey = shortenText(compact.planning.scopeKey, 96);
    compact.planning.goalRef = shortenText(compact.planning.goalRef, 96);
    compact.planning.roadmapRef = shortenText(compact.planning.roadmapRef, 96);
    compact.planning.planRef = shortenText(compact.planning.planRef, 96);
    compact.planning.workPointRefs = compact.planning.workPointRefs.slice(0, 4).map((entry) => shortenText(entry, 96));
    compact.planning.projectRunRef = shortenText(compact.planning.projectRunRef, 96);
    compact.repositories = compact.repositories.slice(0, 6).map((repository) => ({
      ...repository,
      ownedPaths: repository.ownedPaths.slice(0, 6).map((entry) => shortenText(entry, 120)),
      changedPaths: repository.changedPaths.slice(0, 6).map((entry) => shortenText(entry, 120)),
    }));
    compact.resume.drift = compact.resume.drift.slice(0, 4).map((entry) => shortenText(entry, 180));
    compact.gitCheckpoint.validationRefs = compact.gitCheckpoint.validationRefs.slice(0, 4).map((entry) => shortenText(entry, 120));
  }
  for (const field of arrayFields) {
    if (Array.isArray(compact[field])) compact[field] = compact[field].map((entry) => shortenText(entry, 240));
  }
  compact.nextAction = shortenText(compact.nextAction, 320);
  compact.goalId = shortenText(compact.goalId, 128);
  let serialized = JSON.stringify(compact);
  while (estimateTokens(contextFor(serialized)) > maximumTokens) {
      if (Array.isArray(compact.attentionSignals) && compact.attentionSignals.length > 1) {
        compact.attentionSignals.pop();
        serialized = JSON.stringify(compact);
        continue;
      }
      const repository = Array.isArray(compact.repositories)
      ? compact.repositories.find((entry) => entry.ownedPaths.length > 0 || entry.changedPaths.length > 0)
      : null;
    let removed = false;
    if (repository && repository.changedPaths.length > 0) { repository.changedPaths.pop(); removed = true; }
    else if (repository && repository.ownedPaths.length > 0) { repository.ownedPaths.pop(); removed = true; }
    else if (Array.isArray(compact.repositories) && compact.repositories.length > 1) { compact.repositories.pop(); removed = true; }
    else {
      const field = arrayFields.find((candidate) => Array.isArray(compact[candidate]) && compact[candidate].length > 0);
      if (field) { compact[field].pop(); removed = true; }
      else {
        const structuredField = structuredArrayFields.find((candidate) => Array.isArray(compact[candidate]) && compact[candidate].length > 0);
        if (structuredField) { compact[structuredField].pop(); removed = true; }
      }
    }
    if (!removed) break;
    serialized = JSON.stringify(compact);
  }
  if (estimateTokens(contextFor(serialized)) > maximumTokens) {
    compact.nextAction = shortenText(compact.nextAction, 96);
    compact.goalId = shortenText(compact.goalId, 48);
    serialized = JSON.stringify(compact);
  }
  return serialized;
}

function goalFrameForInjection(frame, dynamicSource = frame) {
  const currentAssurancePolicy = dynamicSource?.assurancePolicy ?? frame.assurancePolicy;
  const currentAttentionSignals = dynamicSource?.attentionSignals ?? frame.attentionSignals;
  const compact = {
    schemaVersion: frame.schemaVersion,
    kind: frame.kind,
    goalId: shortenText(frame.goalId, 96),
    successCriteria: frame.successCriteria.slice(0, 3).map((entry) => shortenText(entry, 180)),
    canonicalAuthority: shortenText(frame.canonicalAuthority, 160),
    planning: {
      surface: frame.planning.surface,
      scopeKey: shortenText(frame.planning.scopeKey, 96),
      goalRef: shortenText(frame.planning.goalRef, 96),
      roadmapRef: shortenText(frame.planning.roadmapRef, 96),
      planRef: shortenText(frame.planning.planRef, 96),
      workPointRefs: frame.planning.workPointRefs.slice(0, 4).map((entry) => shortenText(entry, 96)),
      projectRunRef: shortenText(frame.planning.projectRunRef, 96),
      authorityStatus: frame.planning.authorityStatus,
    },
    repositories: frame.repositories.slice(0, 4).map((repository) => ({
      repositoryId: shortenText(repository.repositoryId, 96),
      branch: shortenText(repository.branch, 96),
      baseRef: shortenText(repository.baseRef, 96),
      headRef: shortenText(repository.headRef, 96),
      worktreeStatus: repository.worktreeStatus,
      ownedPaths: repository.ownedPaths.slice(0, 4).map((entry) => shortenText(entry, 100)),
      changedPaths: repository.changedPaths.slice(0, 4).map((entry) => shortenText(entry, 100)),
      commitRef: shortenText(repository.commitRef, 96),
    })),
    dependencyWaves: frame.dependencyWaves.slice(0, 6).map((wave) => ({
      waveId: shortenText(wave.waveId, 96),
      dependsOn: wave.dependsOn.slice(0, 4).map((entry) => shortenText(entry, 96)),
      status: wave.status,
      workPointRef: shortenText(wave.workPointRef, 96),
      planRef: shortenText(wave.planRef, 96),
      projectRunRef: shortenText(wave.projectRunRef, 96),
    })),
    integrationOwner: shortenText(frame.integrationOwner, 96),
    ...(currentAssurancePolicy ? { assurancePolicy: { ...currentAssurancePolicy } } : {}),
    ...(Array.isArray(currentAttentionSignals) ? { attentionSignals: compactAttentionSignals(currentAttentionSignals) } : {}),
  };
  const contextFor = (serialized) => `Latest verified same-session goal frame:\nGOAL_SESSION_FRAME\n\`\`\`json\n${serialized}\n\`\`\``;
  let serialized = JSON.stringify(compact);
  const trimRepository = () => {
    const repository = compact.repositories.find((entry) => entry.ownedPaths.length > 0 || entry.changedPaths.length > 0);
    if (!repository) return false;
    if (repository.changedPaths.length > 0) repository.changedPaths.pop();
    else repository.ownedPaths.pop();
    return true;
  };
  while (estimateTokens(contextFor(serialized)) > MAX_INJECTED_CHECKPOINT_TOKENS) {
    if (compact.successCriteria.length > 1) compact.successCriteria.pop();
    else if (compact.dependencyWaves.length > 1) compact.dependencyWaves.pop();
    else if (compact.repositories.length > 1) compact.repositories.pop();
    else if (compact.attentionSignals && compact.attentionSignals.length > 1) compact.attentionSignals.pop();
    else if (trimRepository()) {
      // Keep at least one repository and its identity; trim paths before identities.
    } else if (compact.canonicalAuthority.length > 48) compact.canonicalAuthority = shortenText(compact.canonicalAuthority, 48);
    else break;
    serialized = JSON.stringify(compact);
  }
  return serialized;
}

function gitResult(cwd, args) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) return null;
  const result = childProcess.spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 2500,
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function observeGit(cwd) {
  const repositoryRoot = gitResult(cwd, ['rev-parse', '--show-toplevel']);
  const headRef = gitResult(cwd, ['rev-parse', 'HEAD']);
  if (!repositoryRoot || !headRef) return null;
  const branch = gitResult(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || '(detached)';
  const changed = gitResult(cwd, ['diff', '--name-only', '-z', 'HEAD']);
  const untracked = gitResult(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (changed === null || untracked === null) return null;
  const changedPaths = [...new Set(`${changed}\0${untracked}`.split('\0').map((entry) => entry.trim()).filter(Boolean))].sort();
  const observed = {
    repositoryId: path.basename(repositoryRoot),
    branch,
    headRef,
    worktreeStatus: changedPaths.length === 0 ? 'clean' : 'dirty',
    changedPaths,
  };
  return {
    ...observed,
    worktreeDigest: crypto.createHash('sha256').update(canonicalJson(observed)).digest('hex'),
  };
}

function hasPatternPath(value) {
  return /[*?\[\]]/.test(value) || /[\\\/]$/.test(value);
}

function reconcileCheckpoint(checkpoint, cwd) {
  const checkedAt = nowIso();
  if (!checkpoint || checkpoint.schemaVersion !== '2') {
    return { status: 'unavailable', checkedAt, repositoryId: null, observed: null, drift: [], limitations: ['schema-v2 checkpoint required'] };
  }
  const observed = observeGit(cwd);
  if (!observed) {
    return { status: 'unavailable', checkedAt, repositoryId: null, observed: null, drift: [], limitations: ['session cwd is not an inspectable Git worktree'] };
  }
  const repository = checkpoint.repositories.find((entry) => entry.repositoryId.toLowerCase() === observed.repositoryId.toLowerCase())
    || (checkpoint.repositories.length === 1 ? checkpoint.repositories[0] : null);
  if (!repository) {
    return { status: 'unavailable', checkedAt, repositoryId: null, observed, drift: [], limitations: ['session cwd could not be matched to a checkpoint repository'] };
  }
  const drift = [];
  if (repository.branch !== observed.branch) drift.push({ code: 'branch_changed', expected: repository.branch, actual: observed.branch });
  const headMatches = repository.headRef === observed.headRef
    || (repository.headRef.length >= 7 && observed.headRef.startsWith(repository.headRef));
  if (!headMatches) drift.push({ code: 'head_changed', expected: repository.headRef, actual: observed.headRef });
  if (repository.worktreeStatus !== 'unknown' && repository.worktreeStatus !== observed.worktreeStatus) {
    drift.push({ code: 'worktree_status_changed', expected: repository.worktreeStatus, actual: observed.worktreeStatus });
  }
  const limitations = [];
  if (repository.changedPaths.some(hasPatternPath)) {
    limitations.push('changed-path comparison skipped because the checkpoint contains a pattern or directory scope');
  } else {
    const expectedPaths = [...new Set(repository.changedPaths.map((entry) => entry.replace(/\\/g, '/')))].sort();
    const actualPaths = observed.changedPaths.map((entry) => entry.replace(/\\/g, '/'));
    if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
      drift.push({ code: 'changed_paths_changed', expected: expectedPaths, actual: actualPaths });
    }
  }
  return {
    status: drift.length === 0 ? 'reconciled' : 'drifted',
    checkedAt,
    repositoryId: repository.repositoryId,
    observed,
    drift,
    limitations,
  };
}

function persistReconciliation(root, binding, reconciliation) {
  const safeReconciliation = redactJson(reconciliation);
  atomicWriteJson(path.join(sessionDirectory(root, binding.canonicalThreadId), 'reconciliation.json'), {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-checkpoint-reconciliation',
    canonicalThreadId: binding.canonicalThreadId,
    codexSessionId: binding.sessionId,
    reconciliation: safeReconciliation,
  });
}

function reconciliationForInjection(reconciliation) {
  if (!reconciliation) return null;
  return JSON.stringify({
    status: reconciliation.status,
    checkedAt: reconciliation.checkedAt,
    repositoryId: reconciliation.repositoryId,
    observed: reconciliation.observed ? {
      branch: reconciliation.observed.branch,
      headRef: reconciliation.observed.headRef,
      worktreeStatus: reconciliation.observed.worktreeStatus,
      changedPaths: reconciliation.observed.changedPaths.slice(0, 12),
      worktreeDigest: reconciliation.observed.worktreeDigest,
    } : null,
    drift: reconciliation.drift.slice(0, 8),
    limitations: reconciliation.limitations.slice(0, 4),
  });
}

function continuationContext(root, binding, cwd) {
  let frame = readValidGoalFrame(root, binding);
  const checkpoint = readValidCheckpoint(root, binding);
  if (frame && checkpoint && !goalRunRecordsCompatible(frame.frame, checkpoint.checkpoint)) frame = null;
  const parts = [];
  if (frame) parts.push(`Latest verified same-session goal frame:\nGOAL_SESSION_FRAME\n\`\`\`json\n${goalFrameForInjection(frame.frame, checkpoint?.checkpoint || frame.frame)}\n\`\`\``);
  if (checkpoint) {
    const reconciliation = reconcileCheckpoint(checkpoint.checkpoint, cwd);
    persistReconciliation(root, binding, reconciliation);
    const runtimeState = reconciliationForInjection(reconciliation);
    parts.push(`Latest verified same-session checkpoint:\nSESSION_CHECKPOINT\n\`\`\`json\n${checkpointForInjection(checkpoint.checkpoint, 1225)}\n\`\`\`\n\nIndependent runtime observation:\nRUNTIME_RECONCILIATION\n\`\`\`json\n${runtimeState}\n\`\`\``);
  }
  if (parts.length === 0) return null;
  let context = parts.join('\n\n');
  while (estimateTokens(context) > MAX_INJECTED_CHECKPOINT_TOKENS && parts.length > 1) {
    // The checkpoint contains the current phase and next action; keep it over
    // the older frame when the combined projection exceeds the cap.
    parts.shift();
    context = parts.join('\n\n');
  }
  if (estimateTokens(context) > MAX_INJECTED_CHECKPOINT_TOKENS && checkpoint) {
    const reconciliation = reconcileCheckpoint(checkpoint.checkpoint, cwd);
    context = `Latest verified same-session checkpoint:\nSESSION_CHECKPOINT\n\`\`\`json\n${checkpointForInjection(checkpoint.checkpoint, 1325)}\n\`\`\`\n\nRuntime reconciliation status: ${reconciliation.status}; drift=${JSON.stringify(reconciliation.drift.slice(0, 3))}`;
  }
  if (estimateTokens(context) > MAX_INJECTED_CHECKPOINT_TOKENS && checkpoint) {
    context = `Latest verified same-session checkpoint:\nSESSION_CHECKPOINT\n\`\`\`json\n${checkpointForInjection(checkpoint.checkpoint, 1450)}\n\`\`\``;
  }
  return context;
}

function recordPreCompact(root, binding, trigger, checkpointStatus) {
  atomicWriteJson(path.join(sessionDirectory(root, binding.canonicalThreadId), 'precompact.json'), {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-precompact-observation',
    canonicalThreadId: binding.canonicalThreadId,
    codexSessionId: binding.sessionId,
    trigger: trigger === 'manual' ? 'manual' : trigger === 'auto' ? 'auto' : 'unknown',
    checkpointStatus,
    recordedAt: nowIso(),
  });
}

function extractAgentResult(lastAssistantMessage, identity, expectedContext = null) {
  if (typeof lastAssistantMessage !== 'string') return { receipt: 'missing', status: null };
  if (!/(?:^|\r?\n)AGENT_RESULT\s*\r?\n/.test(lastAssistantMessage)) return { receipt: 'missing', status: null };
  const match = lastAssistantMessage.match(/(?:^|\r?\n)AGENT_RESULT\s*\r?\n```json\s*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (!match) return { receipt: 'invalid', status: null };
  try {
    const receipt = redactJson(JSON.parse(match[1]));
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { receipt: 'invalid', status: null };
    if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify([...AGENT_RESULT_FIELDS].sort())) return { receipt: 'invalid', status: null };
    if (!identity || !safeCanonicalThreadId(identity.agentId) || !MANAGED_SUBAGENT_TYPES.has(identity.agentType)) return { receipt: 'invalid', status: null };
    if (receipt.agentId !== identity.agentId || receipt.role !== identity.agentType) return { receipt: 'invalid', status: null };
    if (!isNullableNonEmptyString(receipt.taskId)
      || !['repositoryId', 'baseRef', 'headRef'].every((field) => isNullableNonEmptyString(receipt[field]))) return { receipt: 'invalid', status: null };
    if (!['completed', 'partial', 'blocked', 'failed', 'interrupted'].includes(receipt.status)) return { receipt: 'invalid', status: null };
    if (!['ownedScope', 'outcome', 'evidence', 'validation', 'dependencies', 'blockers', 'residualRisks'].every((field) => isStringArray(receipt[field]))) return { receipt: 'invalid', status: null };
    if (!receipt.payload || typeof receipt.payload !== 'object' || Array.isArray(receipt.payload)
      || receipt.payload.kind !== PAYLOAD_KIND_BY_AGENT_TYPE.get(identity.agentType)
      || Buffer.byteLength(JSON.stringify(receipt), 'utf8') > MAX_STORED_RECEIPT_BYTES) return { receipt: 'invalid', status: null };
    if (expectedContext && (receipt.payload.goalId !== expectedContext.goalId
      || receipt.payload.activeWaveId !== expectedContext.activeWaveId
      || receipt.payload.contextHash !== expectedContext.contextHash)) return { receipt: 'invalid', status: null };
    return { receipt: 'valid', status: receipt.status, value: receipt };
  } catch {
    return { receipt: 'invalid', status: null };
  }
}

function saveSubagentReceipt(root, binding, identity, receipt, goalRunMetadata = null) {
  const value = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-subagent-receipt',
    canonicalThreadId: binding.canonicalThreadId,
    codexSessionId: binding.sessionId,
    agentId: identity.agentId,
    agentType: identity.agentType,
    goalId: goalRunMetadata?.goalId || null,
    activeWaveId: goalRunMetadata?.activeWaveId || null,
    checkpointRef: goalRunMetadata?.checkpointRef || null,
    contextHash: goalRunMetadata?.contextHash || null,
    receivedAt: nowIso(),
    receipt,
  };
  atomicWriteJson(path.join(receiptDirectory(root, binding.canonicalThreadId), `${identity.agentId}.json`), value);
  return value;
}

function readRecentSubagentReceipts(root, binding) {
  const directory = receiptDirectory(root, binding.canonicalThreadId);
  const currentGoalRun = readGoalRunMetadata(root, binding);
  let entries;
  try {
    entries = fs.readdirSync(directory)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => {
        const filePath = path.join(directory, entry);
        return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, MAX_RECEIPT_FILES_TO_INSPECT);
  } catch {
    return [];
  }
  return entries
    .map(({ filePath }) => readJson(filePath, null))
    .filter((value) => value
      && value.schemaVersion === SCHEMA_VERSION
      && value.kind === 'codex-subagent-receipt'
      && value.canonicalThreadId === binding.canonicalThreadId
      && value.codexSessionId === binding.sessionId
      && safeCanonicalThreadId(value.agentId)
      && MANAGED_SUBAGENT_TYPES.has(value.agentType)
      && !Number.isNaN(Date.parse(value.receivedAt))
      && (!currentGoalRun || (value.goalId === currentGoalRun.goalId
        && value.activeWaveId === currentGoalRun.activeWaveId
        && value.contextHash === currentGoalRun.contextHash))
      && extractAgentResult(`AGENT_RESULT\n\`\`\`json\n${JSON.stringify(value.receipt)}\n\`\`\``, value).receipt === 'valid')
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
    .slice(0, MAX_RECENT_RECEIPTS);
}

function compactReceiptForInjection(value) {
  const receipt = value.receipt;
  const compactArray = (entries) => entries.slice(0, 2).map((entry) => shortenText(entry, 160));
  return {
    agentId: value.agentId,
    role: value.agentType,
    goalId: value.goalId || null,
    activeWaveId: value.activeWaveId || null,
    contextHash: value.contextHash || null,
    taskId: receipt.taskId,
    status: receipt.status,
    repositoryId: receipt.repositoryId,
    baseRef: receipt.baseRef,
    headRef: receipt.headRef,
    outcome: compactArray(receipt.outcome),
    evidence: compactArray(receipt.evidence),
    validation: compactArray(receipt.validation),
    blockers: compactArray(receipt.blockers),
    residualRisks: compactArray(receipt.residualRisks),
  };
}

function subagentStartContext(root, input, binding) {
  const identity = safeCanonicalThreadId(input.agent_id);
  const contract = identity && MANAGED_SUBAGENT_TYPES.has(input.agent_type)
    ? `End with exactly one machine-readable AGENT_RESULT JSON object. Put AGENT_RESULT on the line before a fenced JSON object; use agentId ${identity} and role ${input.agent_type}; include taskId, agentId, role, status, ownedScope, repositoryId, baseRef, headRef, outcome, evidence, validation, dependencies, blockers, residualRisks, and payload. Status is completed|partial|blocked|failed|interrupted. Do not include prompts, transcripts, or tool output.`
    : 'End with exactly one machine-readable AGENT_RESULT JSON object. Put AGENT_RESULT on the line before a fenced JSON object; include taskId, agentId, role, status, ownedScope, repositoryId, baseRef, headRef, outcome, evidence, validation, dependencies, blockers, residualRisks, and payload. Status is completed|partial|blocked|failed|interrupted. Do not include prompts, transcripts, or tool output.';
  const packetReminder = ' If a verified goal-run context is supplied, confirm goalId, planningRefs, activeWaveId, ownedScope, validation, and checkpointRef before work; echo goalId, activeWaveId, and contextHash in payload; report missing or conflicting fields as blocked.';
  const contractWithPacket = `${contract}${packetReminder}`;
  if (!binding) return contractWithPacket;
  const frame = readValidGoalFrame(root, binding);
  const checkpoint = readValidCheckpoint(root, binding);
  const goalRunMetadata = readGoalRunMetadata(root, binding);
  const frameSummary = frame && goalRunMetadata
    ? `\n\nVerified goal-run context (same session, bounded):\n\`\`\`json\n${goalFrameForInjection(frame.frame, checkpoint?.checkpoint || frame.frame)}\n\`\`\`\nGoal-run binding: \`\`\`json\n${JSON.stringify(goalRunMetadata)}\n\`\`\``
    : '';
  if (estimateTokens(`${contractWithPacket}${frameSummary}`) > MAX_SUBAGENT_START_CONTEXT_TOKENS) return contractWithPacket;
  const prefix = `${contractWithPacket}${frameSummary}`;
  const summaries = [];
  for (const receipt of readRecentSubagentReceipts(root, binding)) {
    const candidate = [...summaries, compactReceiptForInjection(receipt)];
    const suffix = `\n\nRecent verified subagent receipts (same session, bounded):\n\`\`\`json\n${JSON.stringify(candidate)}\n\`\`\``;
    if (estimateTokens(`${prefix}${suffix}`) > MAX_SUBAGENT_START_CONTEXT_TOKENS) break;
    summaries.push(compactReceiptForInjection(receipt));
  }
  if (summaries.length === 0) return prefix;
  return `${prefix}\n\nRecent verified subagent receipts (same session, bounded):\n\`\`\`json\n${JSON.stringify(summaries)}\n\`\`\``;
}

function recordSubagentStop(root, binding, input) {
  const telemetryPath = path.join(sessionDirectory(root, binding.canonicalThreadId), 'telemetry.json');
  const current = readJson(telemetryPath, { schemaVersion: SCHEMA_VERSION, events: [] });
  const events = Array.isArray(current.events) ? current.events : [];
  const identity = { agentId: input.agent_id, agentType: input.agent_type };
  const goalRunMetadata = readGoalRunMetadata(root, binding);
  const classification = extractAgentResult(input.last_assistant_message, identity, goalRunMetadata);
  if (classification.receipt === 'valid') saveSubagentReceipt(root, binding, identity, classification.value, goalRunMetadata);
  events.push({
    event: 'SubagentStop',
    observedAt: nowIso(),
    agentId: typeof input.agent_id === 'string' ? input.agent_id : '',
    agentType: typeof input.agent_type === 'string' ? input.agent_type : '',
    turnId: typeof input.turn_id === 'string' ? input.turn_id : '',
    receipt: classification.receipt,
    status: classification.status,
  });
  atomicWriteJson(telemetryPath, {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-subagent-telemetry',
    canonicalThreadId: binding.canonicalThreadId,
    events: events.slice(-MAX_TELEMETRY_EVENTS),
  });
}

function queueEnabled() {
  return process.env.ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED === '1';
}

function queueDirectory(root) {
  return path.join(root, 'queue');
}

function jobIdFor(binding) {
  return crypto.createHash('sha256').update(`${binding.canonicalThreadId}\0${binding.sessionId}`).digest('hex');
}

function queueJobPath(root, jobId) {
  return path.join(queueDirectory(root), `${jobId}.json`);
}

function createQueueJob(root, binding) {
  const id = jobIdFor(binding);
  const filePath = queueJobPath(root, id);
  const existing = readJson(filePath, null);
  if (existing?.idempotencyKey === id) return existing;
  const createdAt = now();
  const job = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-session-end-reference',
    id,
    idempotencyKey: id,
    state: 'pending',
    canonicalThreadId: binding.canonicalThreadId,
    codexSessionId: binding.sessionId,
    attempts: 0,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + QUEUE_TTL_MS).toISOString(),
    leaseExpiresAt: null,
    terminalEligibility: 'host_evaluator_pending',
    evaluatorExcluded: false,
  };
  atomicWriteJson(filePath, job);
  return job;
}

function listQueueJobs(root) {
  const directory = queueDirectory(root);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => ({ filePath: path.join(directory, entry), job: readJson(path.join(directory, entry), null) }))
    .filter((entry) => entry.job && typeof entry.job === 'object');
}

function expireJob(job) {
  if (!job || !job.expiresAt || Date.parse(job.expiresAt) > now().getTime()) return job;
  return { ...job, state: 'skipped', leaseExpiresAt: null, updatedAt: nowIso(), skipReason: 'ttl_expired' };
}

function claimQueueJob(root) {
  if (!queueEnabled()) return { state: 'disabled' };
  for (const { filePath, job: rawJob } of listQueueJobs(root)) {
    let job = expireJob(rawJob);
    if (job !== rawJob) {
      atomicWriteJson(filePath, job);
      continue;
    }
    const leaseExpired = job.state === 'claimed' && Date.parse(job.leaseExpiresAt || '') <= now().getTime();
    if ((job.state !== 'pending' && !leaseExpired) || Number(job.attempts || 0) >= 2) continue;
    job = {
      ...job,
      state: 'claimed',
      attempts: Number(job.attempts || 0) + 1,
      updatedAt: nowIso(),
      leaseExpiresAt: new Date(now().getTime() + QUEUE_LEASE_MS).toISOString(),
    };
    atomicWriteJson(filePath, job);
    return { job };
  }
  return { job: null };
}

function transitionQueueJob(root, id, target) {
  if (!queueEnabled()) return { state: 'disabled' };
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw new Error('Queue job id must be a SHA-256 value');
  const filePath = queueJobPath(root, id);
  const current = readJson(filePath, null);
  if (!current) throw new Error('Queue job not found');
  const expired = expireJob(current);
  if (expired !== current) {
    atomicWriteJson(filePath, expired);
    return { job: expired };
  }
  let job;
  if (target === 'complete') {
    job = { ...current, state: 'completed', leaseExpiresAt: null, updatedAt: nowIso() };
  } else if (target === 'skip') {
    job = { ...current, state: 'skipped', leaseExpiresAt: null, updatedAt: nowIso(), skipReason: 'manual' };
  } else if (target === 'tombstone') {
    job = {
      ...current,
      state: 'skipped',
      leaseExpiresAt: null,
      updatedAt: nowIso(),
      skipReason: 'tombstone_unsupported',
      evaluatorExcluded: true,
      terminalEligibility: 'excluded',
    };
  } else if (target === 'fail') {
    job = Number(current.attempts || 0) < 2
      ? { ...current, state: 'pending', leaseExpiresAt: null, updatedAt: nowIso() }
      : { ...current, state: 'failed', leaseExpiresAt: null, updatedAt: nowIso() };
  } else {
    throw new Error('Unsupported queue transition');
  }
  atomicWriteJson(filePath, job);
  return { job };
}

function hookOutput(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseInput() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function unavailableWarning() {
  return 'Elegy checkpoint unavailable: no verified session binding exists; create or update the binding manually.';
}

function countJsonFiles(directory) {
  try {
    return fs.readdirSync(directory).filter((entry) => entry.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

function operatorView(checkpointEnvelope, reconciliation) {
  if (!checkpointEnvelope) return null;
  const checkpoint = checkpointEnvelope.checkpoint;
  const blockingRecords = [
    ...(Array.isArray(checkpoint.blockerRecords) ? checkpoint.blockerRecords : []),
    ...(Array.isArray(checkpoint.externalGateRecords) ? checkpoint.externalGateRecords : []),
  ].filter((entry) => entry.blocking === true && !['resolved', 'passed', 'waived'].includes(entry.status));
  const validationReceipts = Array.isArray(checkpoint.validationReceipts) ? checkpoint.validationReceipts : [];
  const validationStatus = validationReceipts.some((entry) => ['failed', 'blocked'].includes(entry.status))
    ? 'failed_or_blocked'
    : validationReceipts.length > 0 && validationReceipts.every((entry) => ['passed', 'skipped'].includes(entry.status))
      ? 'passed'
      : validationReceipts.length > 0 ? 'pending' : 'summary-only';
  return {
    goalId: checkpoint.goalId,
    phase: checkpoint.phase,
    activeWaveId: checkpoint.activeWaveId,
    checkpointId: checkpointEnvelope.checkpointId || null,
    sequence: checkpointEnvelope.sequence || null,
    validationStatus,
    blockingItemCount: blockingRecords.length,
    reconciliationStatus: reconciliation?.status || 'unavailable',
    changedPathCount: reconciliation?.observed?.changedPaths?.length ?? null,
    nextAction: checkpoint.nextAction,
  };
}

function runtimeStatus(root, sessionId, cwd) {
  const stateRootExists = fs.existsSync(root);
  const bindingsDocument = readJson(path.join(root, 'bindings.json'), { bindings: {} });
  const bindingCount = Object.values(bindingsDocument.bindings || {}).filter((entry) => entry?.verified === true).length;
  if (!sessionId) {
    let sessionCount = 0;
    try {
      sessionCount = fs.readdirSync(path.join(root, 'sessions'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
    } catch {
      sessionCount = 0;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'codex-workflow-runtime-status',
      stateRootExists,
      bindingCount,
      sessionCount,
      activationState: stateRootExists ? 'runtime-observed' : 'not-observed',
      note: 'Hook discovery and trust require hooks/list and /hooks; filesystem state alone is not activation proof.',
    };
  }
  const binding = getVerifiedBinding(root, sessionId);
  if (!binding) {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'codex-workflow-session-status',
      sessionId,
      activationState: 'unbound',
      binding: 'missing_or_unverified',
      frame: 'unavailable',
      checkpoint: 'unavailable',
      historyCount: 0,
      reconciliation: null,
    };
  }
  const sessionRoot = sessionDirectory(root, binding.canonicalThreadId);
  const rawFrame = readJson(path.join(sessionRoot, 'goal-session.json'), null);
  const rawCheckpoint = readJson(path.join(sessionRoot, 'checkpoint.json'), null);
  const frame = readValidGoalFrame(root, binding);
  const checkpoint = readValidCheckpoint(root, binding);
  let reconciliation = checkpoint ? reconcileCheckpoint(checkpoint.checkpoint, cwd) : null;
  if (reconciliation) {
    persistReconciliation(root, binding, reconciliation);
    reconciliation = redactJson(reconciliation);
  }
  const classify = (raw, valid) => {
    if (valid) return 'valid';
    if (!raw) return 'missing';
    return Number.isNaN(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) > now().getTime() ? 'invalid' : 'expired';
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-workflow-session-status',
    sessionId,
    canonicalThreadId: binding.canonicalThreadId,
    activationState: checkpoint ? 'checkpoint-persisted' : frame ? 'frame-persisted' : 'bound',
    binding: 'verified',
    frame: classify(rawFrame, frame),
    checkpoint: classify(rawCheckpoint, checkpoint),
    checkpointId: checkpoint?.checkpointId || null,
    sequence: checkpoint?.sequence || null,
    historyCount: countJsonFiles(checkpointHistoryDirectory(root, binding.canonicalThreadId)),
    reconciliation,
    operatorView: operatorView(checkpoint, reconciliation),
  };
}

function handleEvent(event, input, root) {
  const binding = getVerifiedBinding(root, input.session_id);
  if (event === 'Stop') {
    if (binding) {
      const frame = extractGoalFrame(input.last_assistant_message);
      const checkpoint = extractCheckpoint(input.last_assistant_message);
      if (frame && checkpoint && !goalRunRecordsCompatible(frame, checkpoint)) {
        return { continue: true, systemMessage: 'Elegy goal checkpoint ignored: frame and checkpoint identity did not match.' };
      }
      if (frame) saveGoalFrame(root, binding, frame);
      if (checkpoint) saveCheckpoint(root, binding, checkpoint, reconcileCheckpoint(checkpoint, input.cwd));
    }
    return { continue: true };
  }
  if (event === 'PreCompact') {
    if (binding) {
      const checkpointStatus = readValidCheckpoint(root, binding) ? 'valid' : 'missing_or_invalid';
      recordPreCompact(root, binding, input.trigger || input.source, checkpointStatus);
    }
    return { continue: true };
  }
  if (event === 'SessionStart') {
    if (input.source !== 'compact') return { continue: true };
    if (!binding) return { continue: true, systemMessage: unavailableWarning() };
    const context = continuationContext(root, binding, input.cwd);
    if (!context) return { continue: true, systemMessage: 'Elegy checkpoint unavailable: no valid same-session checkpoint or goal frame was found; continuing normally.' };
    const reconciliation = readJson(path.join(sessionDirectory(root, binding.canonicalThreadId), 'reconciliation.json'), null)?.reconciliation;
    return {
      continue: true,
      ...(reconciliation?.status === 'drifted'
        ? { systemMessage: 'Elegy checkpoint drift detected. Review RUNTIME_RECONCILIATION before editing.' }
        : {}),
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    };
  }
  if (event === 'SubagentStart') {
    if (!MANAGED_SUBAGENT_TYPES.has(input.agent_type)) return { continue: true };
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: subagentStartContext(root, input, binding),
      },
    };
  }
  if (event === 'SubagentStop') {
    if (binding) recordSubagentStop(root, binding, input);
    return { continue: true };
  }
  if (event === 'SessionEnd') {
    if (binding && queueEnabled()) createQueueJob(root, binding);
    return { continue: true };
  }
  return { continue: true };
}

function main() {
  const [command, id] = process.argv.slice(2);
  const root = defaultRoot();
  if (command === 'status') return hookOutput(runtimeStatus(root, id, process.cwd()));
  if (command === 'queue') {
    const [operation, jobId] = process.argv.slice(3);
    if (operation === 'claim') return hookOutput(claimQueueJob(root));
    return hookOutput(transitionQueueJob(root, jobId, operation));
  }
  hookOutput(handleEvent(command, parseInput(), root));
}

try {
  main();
} catch (error) {
  process.stderr.write(`Elegy Codex hook warning: ${error.message || String(error)}\n`);
  hookOutput({ continue: true, systemMessage: 'Elegy hook failed open; continuing without checkpoint assistance.' });
}
