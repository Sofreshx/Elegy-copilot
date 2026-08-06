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
const MAX_INJECTED_CHECKPOINT_TOKENS = 1500;
const MAX_TELEMETRY_EVENTS = 100;
const MAX_STORED_RECEIPT_BYTES = 24 * 1024;
const MAX_RECEIPT_FILES_TO_INSPECT = 24;
const MAX_RECENT_RECEIPTS = 3;
const MAX_SUBAGENT_START_CONTEXT_TOKENS = 600;
const MAX_STORED_COMPACT_BASELINE_BYTES = 8 * 1024;
const MAX_STORED_COMPACT_UPDATE_BYTES = 4 * 1024;
const MAX_OBSERVED_CHANGED_PATHS = 64;
const COMPACT_RECORD_EVENTS = ['wave-complete', 'blocked', 'decision', 'handoff', 'interrupted', 'closure'];
const COMPACT_GIT_STATUSES = ['committed', 'clean', 'uncommitted', 'not-applicable'];
const COMPACT_GATE_STATUSES = ['pending', 'passed', 'failed', 'waived', 'unavailable'];
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

function boundedStringIsValid(value, maximumLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximumLength;
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

function redactJson(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJson(entry)]));
  }
  return value;
}

function compactStatePath(root, binding) {
  return path.join(sessionDirectory(root, binding.canonicalThreadId), 'session-state.json');
}

function compactUpdateDirectory(root, binding) {
  return path.join(sessionDirectory(root, binding.canonicalThreadId), 'session-updates');
}

function compactWaveGraphIsValid(waves) {
  if (!Array.isArray(waves) || waves.length === 0) return false;
  const ids = new Set();
  for (const wave of waves) {
    if (!hasExactKeys(wave, ['waveId', 'dependsOn', 'deliverable'])
      || !boundedStringIsValid(wave.waveId, 128)
      || !isStringArray(wave.dependsOn)
      || !boundedStringIsValid(wave.deliverable, 512)
      || ids.has(wave.waveId)) return false;
    ids.add(wave.waveId);
  }
  if (waves.some((wave) => wave.dependsOn.includes(wave.waveId) || wave.dependsOn.some((dependency) => !ids.has(dependency)))) return false;
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

function compactPlanningIsValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = ['scopeKey', 'goalRef', 'roadmapRef', 'planRef', 'workPointRefs', 'projectRunRef'];
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !fields.includes(key))) return false;
  return keys.every((key) => key === 'workPointRefs'
    ? isStringArray(value[key]) && value[key].length > 0
    : boundedStringIsValid(value[key], 256));
}

function compactAssuranceIsValid(value) {
  if (!hasExactKeys(value, ['mode', 'status'], ['gateRef', 'evidenceRefs', 'decisionRef'])) return false;
  if (!['advisory', 'strict'].includes(value.mode)
    || !['suggested', 'requested', 'passed', 'blocked', 'stale'].includes(value.status)) return false;
  if (value.gateRef !== undefined && !boundedStringIsValid(value.gateRef, 256)) return false;
  if (value.evidenceRefs !== undefined && !isStringArray(value.evidenceRefs)) return false;
  if (value.decisionRef !== undefined && !boundedStringIsValid(value.decisionRef, 256)) return false;
  if (value.mode === 'strict' && (value.status === 'suggested' || !value.gateRef)) return false;
  if (value.mode === 'strict' && ['passed', 'blocked'].includes(value.status) && !value.evidenceRefs?.length) return false;
  return !(value.mode === 'strict' && value.status === 'blocked' && !value.decisionRef);
}

function compactRepositoriesAreValid(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const ids = new Set();
  for (const repository of value) {
    if (!hasExactKeys(repository, ['repositoryId', 'root', 'ownedPaths', 'protectedPaths', 'preserveExistingChanges'])
      || !boundedStringIsValid(repository.repositoryId, 128)
      || !boundedStringIsValid(repository.root, 1024)
      || !path.isAbsolute(repository.root)
      || !isStringArray(repository.ownedPaths) || repository.ownedPaths.length === 0
      || !isStringArray(repository.protectedPaths)
      || typeof repository.preserveExistingChanges !== 'boolean'
      || ids.has(repository.repositoryId)) return false;
    ids.add(repository.repositoryId);
  }
  return true;
}

function compactBaselineIsValid(value) {
  if (!hasExactKeys(value,
    ['schemaVersion', 'kind', 'goalId', 'goal', 'successCriteria', 'authority', 'scope', 'protected', 'dependencyWaves', 'current', 'repositories'],
    ['planning', 'assurance'])
    || value.schemaVersion !== '1' || value.kind !== 'baseline'
    || !boundedStringIsValid(value.goalId, 128)
    || !boundedStringIsValid(value.goal, 1024)
    || !isStringArray(value.successCriteria) || value.successCriteria.length === 0
    || !boundedStringIsValid(value.authority, 1024)
    || !isStringArray(value.scope) || value.scope.length === 0
    || !isStringArray(value.protected)
    || !compactWaveGraphIsValid(value.dependencyWaves)
    || !hasExactKeys(value.current, ['activeWave', 'nextAction'])
    || !boundedStringIsValid(value.current.activeWave, 128)
    || !boundedStringIsValid(value.current.nextAction, 1024)
    || !value.dependencyWaves.some((wave) => wave.waveId === value.current.activeWave)
    || !compactRepositoriesAreValid(value.repositories)
    || (value.planning !== undefined && !compactPlanningIsValid(value.planning))
    || (value.assurance !== undefined && !compactAssuranceIsValid(value.assurance))) return false;
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_STORED_COMPACT_BASELINE_BYTES;
}

function compactBlockersAreValid(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  return value.every((blocker) => hasExactKeys(blocker, ['blockerId', 'owner', 'summary', 'blocking'], ['nextDecision'])
    && boundedStringIsValid(blocker.blockerId, 128)
    && boundedStringIsValid(blocker.owner, 256)
    && boundedStringIsValid(blocker.summary, 512)
    && typeof blocker.blocking === 'boolean'
    && (blocker.nextDecision === undefined || boundedStringIsValid(blocker.nextDecision, 512))
    && !ids.has(blocker.blockerId) && Boolean(ids.add(blocker.blockerId)));
}

function compactGatesAreValid(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  return value.every((gate) => hasExactKeys(gate, ['gateId', 'owner', 'blocking', 'status'], ['continueWhen'])
    && boundedStringIsValid(gate.gateId, 128)
    && boundedStringIsValid(gate.owner, 256)
    && typeof gate.blocking === 'boolean'
    && COMPACT_GATE_STATUSES.includes(gate.status)
    && (gate.continueWhen === undefined || boundedStringIsValid(gate.continueWhen, 512))
    && !ids.has(gate.gateId) && Boolean(ids.add(gate.gateId)));
}

function compactGitIsValid(value) {
  return hasExactKeys(value, ['status'], ['commitRef', 'reason'])
    && COMPACT_GIT_STATUSES.includes(value.status)
    && (value.commitRef === undefined || boundedStringIsValid(value.commitRef, 128))
    && (value.reason === undefined || boundedStringIsValid(value.reason, 512))
    && (value.status !== 'committed' || Boolean(value.commitRef));
}

function compactUpdateIsValid(value) {
  const optional = ['completedWaveIds', 'activeWave', 'changed', 'validated', 'decisions', 'risks', 'blockers', 'gates', 'assurance', 'nextAction', 'git'];
  if (!hasExactKeys(value, ['schemaVersion', 'kind', 'goalId', 'event'], optional)
    || value.schemaVersion !== '1' || value.kind !== 'update'
    || !boundedStringIsValid(value.goalId, 128)
    || !COMPACT_RECORD_EVENTS.includes(value.event)
    || !optional.some((field) => Object.hasOwn(value, field))) return false;
  if (value.completedWaveIds !== undefined && (!isStringArray(value.completedWaveIds) || value.completedWaveIds.length === 0)) return false;
  if (value.activeWave !== undefined && value.activeWave !== null && !boundedStringIsValid(value.activeWave, 128)) return false;
  for (const field of ['changed', 'validated', 'decisions', 'risks']) if (value[field] !== undefined && !isStringArray(value[field])) return false;
  if (value.blockers !== undefined && !compactBlockersAreValid(value.blockers)) return false;
  if (value.gates !== undefined && !compactGatesAreValid(value.gates)) return false;
  if (value.assurance !== undefined && !compactAssuranceIsValid(value.assurance)) return false;
  if (value.nextAction !== undefined && !boundedStringIsValid(value.nextAction, 1024)) return false;
  if (value.git !== undefined && !compactGitIsValid(value.git)) return false;
  if (value.event === 'closure' && value.activeWave !== null) return false;
  if (value.event !== 'closure' && value.activeWave === null) return false;
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_STORED_COMPACT_UPDATE_BYTES;
}

function extractCompactRecord(lastAssistantMessage) {
  if (typeof lastAssistantMessage !== 'string') return null;
  const marker = /<!--\s*ELEGY_SESSION_STATE\s*\r?\n([\s\S]*?)\r?\n-->/g;
  const matches = [...lastAssistantMessage.matchAll(marker)];
  if (matches.length !== 1) return null;
  try {
    const value = redactJson(JSON.parse(matches[0][1]));
    return compactBaselineIsValid(value) || compactUpdateIsValid(value) ? value : null;
  } catch {
    return null;
  }
}

function hasLegacyGoalRecord(lastAssistantMessage) {
  return typeof lastAssistantMessage === 'string'
    && /(?:^|\r?\n)(?:GOAL_SESSION_FRAME|SESSION_CHECKPOINT)\s*\r?\n```json/.test(lastAssistantMessage);
}

function compactMaterializedFromBaseline(baseline) {
  return {
    ...baseline,
    completedWaveIds: [],
    activeWave: baseline.current.activeWave,
    nextAction: baseline.current.nextAction,
    changed: [],
    validated: [],
    decisions: [],
    risks: [],
    blockers: [],
    gates: [],
  };
}

function applyCompactUpdate(state, update) {
  if (update.goalId !== state.goalId) return null;
  const waveById = new Map(state.dependencyWaves.map((wave) => [wave.waveId, wave]));
  const completed = new Set(state.completedWaveIds);
  for (const waveId of update.completedWaveIds || []) {
    const wave = waveById.get(waveId);
    if (!wave || wave.dependsOn.some((dependency) => !completed.has(dependency))) return null;
    completed.add(waveId);
  }
  if (update.activeWave !== undefined && update.activeWave !== null && !waveById.has(update.activeWave)) return null;
  return {
    ...state,
    completedWaveIds: [...completed],
    activeWave: update.activeWave === undefined ? state.activeWave : update.activeWave,
    nextAction: update.nextAction === undefined ? state.nextAction : update.nextAction,
    changed: [...new Set([...state.changed, ...(update.changed || [])])],
    validated: [...new Set([...state.validated, ...(update.validated || [])])],
    decisions: [...new Set([...state.decisions, ...(update.decisions || [])])],
    risks: update.risks === undefined ? state.risks : update.risks,
    blockers: update.blockers === undefined ? state.blockers : update.blockers,
    gates: update.gates === undefined ? state.gates : update.gates,
    ...(update.assurance === undefined ? ('assurance' in state ? { assurance: state.assurance } : {}) : { assurance: update.assurance }),
    ...(update.git === undefined ? ('git' in state ? { git: state.git } : {}) : { git: update.git }),
  };
}

function observeCompactRepositories(baseline) {
  return baseline.repositories.map((repository) => {
    const observed = observeGit(path.resolve(repository.root));
    if (!observed) return { repositoryId: repository.repositoryId, root: repository.root, status: 'unavailable' };
    const normalizedPaths = observed.changedPaths.map((entry) => entry.replace(/\\/g, '/'));
    return {
      repositoryId: repository.repositoryId,
      root: repository.root,
      status: 'observed',
      branch: observed.branch,
      headRef: observed.headRef,
      worktreeStatus: observed.worktreeStatus,
      changedPathCount: normalizedPaths.length,
      changedPathDigest: crypto.createHash('sha256').update(canonicalJson(normalizedPaths)).digest('hex'),
      changedPaths: normalizedPaths.slice(0, MAX_OBSERVED_CHANGED_PATHS),
      changedPathsTruncated: normalizedPaths.length > MAX_OBSERVED_CHANGED_PATHS,
    };
  });
}

function validCompactStateEnvelope(value, binding) {
  return Boolean(value
    && value.schemaVersion === SCHEMA_VERSION
    && value.kind === 'codex-compact-session-state'
    && value.canonicalThreadId === binding.canonicalThreadId
    && value.codexSessionId === binding.sessionId
    && compactBaselineIsValid(value.baseline)
    && value.materialized?.goalId === value.baseline.goalId
    && Array.isArray(value.observations)
    && Number.isInteger(value.sequence) && value.sequence >= 0
    && !Number.isNaN(Date.parse(value.expiresAt))
    && Date.parse(value.expiresAt) > now().getTime());
}

function readCompactState(root, binding) {
  const value = readJson(compactStatePath(root, binding), null);
  return validCompactStateEnvelope(value, binding) ? value : null;
}

function saveCompactBaseline(root, binding, baseline) {
  if (readCompactState(root, binding)) return null;
  const recordedAt = now();
  const value = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-compact-session-state',
    canonicalThreadId: binding.canonicalThreadId,
    codexSessionId: binding.sessionId,
    baseline,
    materialized: compactMaterializedFromBaseline(baseline),
    observations: observeCompactRepositories(baseline),
    sequence: 0,
    lastUpdateId: null,
    updatedAt: recordedAt.toISOString(),
    expiresAt: new Date(recordedAt.getTime() + CHECKPOINT_TTL_MS).toISOString(),
  };
  atomicWriteJson(compactStatePath(root, binding), value);
  return value;
}

function saveCompactUpdate(root, binding, update) {
  const current = readCompactState(root, binding);
  if (!current || current.baseline.goalId !== update.goalId) return null;
  const materialized = applyCompactUpdate(current.materialized, update);
  if (!materialized) return null;
  const recordedAt = now();
  const sequence = current.sequence + 1;
  const goalKey = crypto.createHash('sha256').update(update.goalId).digest('hex').slice(0, 10);
  const updateId = `up-${goalKey}-${String(sequence).padStart(6, '0')}`;
  const observations = observeCompactRepositories(current.baseline);
  const wrapper = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-compact-session-update',
    canonicalThreadId: binding.canonicalThreadId,
    codexSessionId: binding.sessionId,
    updateId,
    sequence,
    previousUpdateId: current.lastUpdateId,
    update,
    observations,
    recordedAt: recordedAt.toISOString(),
    expiresAt: new Date(recordedAt.getTime() + CHECKPOINT_TTL_MS).toISOString(),
  };
  atomicWriteJson(path.join(compactUpdateDirectory(root, binding), `${updateId}.json`), wrapper);
  const next = {
    ...current,
    materialized,
    observations,
    sequence,
    lastUpdateId: updateId,
    updatedAt: recordedAt.toISOString(),
    expiresAt: wrapper.expiresAt,
  };
  atomicWriteJson(compactStatePath(root, binding), next);
  return next;
}

function refreshCompactObservations(root, binding) {
  const current = readCompactState(root, binding);
  if (!current) return null;
  const updatedAt = now();
  const next = {
    ...current,
    observations: observeCompactRepositories(current.baseline),
    updatedAt: updatedAt.toISOString(),
    expiresAt: new Date(updatedAt.getTime() + CHECKPOINT_TTL_MS).toISOString(),
  };
  atomicWriteJson(compactStatePath(root, binding), next);
  return next;
}

function reconcileCompactState(state) {
  const checkedAt = nowIso();
  if (!state) return { status: 'unavailable', checkedAt, repositories: [], drift: ['compact session state unavailable'] };
  const current = observeCompactRepositories(state.baseline);
  const previousById = new Map(state.observations.map((entry) => [entry.repositoryId, entry]));
  const drift = [];
  for (const observed of current) {
    const expected = previousById.get(observed.repositoryId);
    if (!expected || expected.status !== 'observed' || observed.status !== 'observed') {
      drift.push({ repositoryId: observed.repositoryId, code: 'repository_unavailable' });
      continue;
    }
    if (expected.branch !== observed.branch) drift.push({ repositoryId: observed.repositoryId, code: 'branch_changed', expected: expected.branch, actual: observed.branch });
    if (expected.headRef !== observed.headRef) drift.push({ repositoryId: observed.repositoryId, code: 'head_changed', expected: expected.headRef, actual: observed.headRef });
    if (expected.changedPathDigest !== observed.changedPathDigest) drift.push({ repositoryId: observed.repositoryId, code: 'changed_paths_changed', expected: expected.changedPathDigest, actual: observed.changedPathDigest });
  }
  return { status: drift.length === 0 ? 'reconciled' : 'drifted', checkedAt, repositories: current, drift };
}

function compactStateForInjection(state) {
  const materialized = state.materialized;
  return JSON.stringify({
    goalId: materialized.goalId,
    goal: shortenText(materialized.goal, 240),
    successCriteria: materialized.successCriteria.slice(0, 4).map((entry) => shortenText(entry, 160)),
    authority: shortenText(materialized.authority, 160),
    scope: materialized.scope.slice(0, 8).map((entry) => shortenText(entry, 120)),
    protected: materialized.protected.slice(0, 8).map((entry) => shortenText(entry, 120)),
    waves: materialized.dependencyWaves.slice(0, 10),
    completedWaveIds: materialized.completedWaveIds,
    activeWave: materialized.activeWave,
    nextAction: shortenText(materialized.nextAction, 240),
    changed: materialized.changed.slice(-8).map((entry) => shortenText(entry, 160)),
    validated: materialized.validated.slice(-8).map((entry) => shortenText(entry, 160)),
    decisions: materialized.decisions.slice(-6).map((entry) => shortenText(entry, 160)),
    risks: materialized.risks.slice(0, 6).map((entry) => shortenText(entry, 160)),
    blockers: materialized.blockers.slice(0, 6),
    gates: materialized.gates.slice(0, 6),
    repositories: state.observations.map((entry) => ({
      repositoryId: entry.repositoryId,
      status: entry.status,
      branch: entry.branch,
      headRef: entry.headRef,
      worktreeStatus: entry.worktreeStatus,
      changedPathCount: entry.changedPathCount,
      changedPathDigest: entry.changedPathDigest,
    })),
    ...(materialized.planning ? { planning: materialized.planning } : {}),
    ...(materialized.assurance ? { assurance: materialized.assurance } : {}),
  });
}

function compactContinuationContext(root, binding) {
  const state = readCompactState(root, binding);
  if (!state) return null;
  const reconciliation = reconcileCompactState(state);
  persistReconciliation(root, binding, reconciliation);
  let context = `Latest verified compact long-work state:\nELEGY_SESSION_STATE\n\`\`\`json\n${compactStateForInjection(state)}\n\`\`\`\n\nIndependent runtime observation:\nRUNTIME_RECONCILIATION\n\`\`\`json\n${JSON.stringify(reconciliation)}\n\`\`\``;
  if (estimateTokens(context) > MAX_INJECTED_CHECKPOINT_TOKENS) {
    context = `Compact long-work state: goalId=${state.materialized.goalId}; activeWave=${state.materialized.activeWave}; nextAction=${shortenText(state.materialized.nextAction, 240)}. Runtime reconciliation=${reconciliation.status}; drift=${JSON.stringify(reconciliation.drift.slice(0, 4))}`;
  }
  return context;
}

function readCompactGoalRunMetadata(root, binding) {
  const state = readCompactState(root, binding);
  if (!state) return null;
  const source = state.materialized;
  const stableState = {
    goalId: source.goalId,
    planning: source.planning || {},
    activeWaveId: source.activeWave,
    repositories: state.observations,
  };
  return {
    goalId: source.goalId,
    activeWaveId: source.activeWave,
    checkpointRef: state.lastUpdateId,
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
  const currentGoalRun = readCompactGoalRunMetadata(root, binding);
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
  const state = readCompactState(root, binding);
  const goalRunMetadata = readCompactGoalRunMetadata(root, binding);
  const boundedState = state ? {
    goalId: state.materialized.goalId,
    planningRefs: state.materialized.planning || {},
    activeWaveId: state.materialized.activeWave,
    repositories: state.observations.slice(0, 4).map((entry) => ({
      repositoryId: entry.repositoryId,
      branch: entry.branch,
      headRef: entry.headRef,
      worktreeStatus: entry.worktreeStatus,
    })),
    ownedScope: state.baseline.repositories.flatMap((repository) => repository.ownedPaths).slice(0, 8),
    validation: state.materialized.validated.slice(-3),
    nextAction: shortenText(state.materialized.nextAction, 160),
  } : null;
  const frameSummary = state && goalRunMetadata
    ? `\n\nVerified goal-run context (same session, bounded):\n\`\`\`json\n${JSON.stringify(boundedState)}\n\`\`\`\nGoal-run binding: \`\`\`json\n${JSON.stringify(goalRunMetadata)}\n\`\`\``
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
  const goalRunMetadata = readCompactGoalRunMetadata(root, binding);
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

function operatorView(state, reconciliation) {
  if (!state) return null;
  const current = state.materialized;
  const blockingItemCount = [
    ...current.blockers.filter((entry) => entry.blocking === true),
    ...current.gates.filter((entry) => entry.blocking === true && !['passed', 'waived'].includes(entry.status)),
  ].length;
  return {
    goalId: current.goalId,
    activeWaveId: current.activeWave,
    lastUpdateId: state.lastUpdateId,
    sequence: state.sequence,
    validationEvidenceCount: current.validated.length,
    blockingItemCount,
    reconciliationStatus: reconciliation?.status || 'unavailable',
    changedPathCount: reconciliation?.repositories?.reduce((total, entry) => total + (entry.changedPathCount || 0), 0) ?? null,
    nextAction: current.nextAction,
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
      compactState: 'unavailable',
      legacyState: 'unavailable',
      historyCount: 0,
      reconciliation: null,
    };
  }
  const sessionRoot = sessionDirectory(root, binding.canonicalThreadId);
  const rawState = readJson(compactStatePath(root, binding), null);
  const state = readCompactState(root, binding);
  const legacyPresent = fs.existsSync(path.join(sessionRoot, 'goal-session.json')) || fs.existsSync(path.join(sessionRoot, 'checkpoint.json'));
  let reconciliation = state ? reconcileCompactState(state) : null;
  if (reconciliation) {
    persistReconciliation(root, binding, reconciliation);
    reconciliation = redactJson(reconciliation);
  }
  const compactStateStatus = state
    ? 'valid'
    : !rawState ? 'missing'
      : Number.isNaN(Date.parse(rawState.expiresAt)) || Date.parse(rawState.expiresAt) > now().getTime() ? 'invalid' : 'expired';
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-workflow-session-status',
    sessionId,
    canonicalThreadId: binding.canonicalThreadId,
    activationState: state ? 'session-state-persisted' : 'bound',
    binding: 'verified',
    compactState: compactStateStatus,
    legacyState: legacyPresent ? 'legacy-unsupported' : 'missing',
    lastUpdateId: state?.lastUpdateId || null,
    sequence: state?.sequence || 0,
    historyCount: countJsonFiles(compactUpdateDirectory(root, binding)),
    reconciliation,
    operatorView: operatorView(state, reconciliation),
  };
}

function handleEvent(event, input, root) {
  const binding = getVerifiedBinding(root, input.session_id);
  if (event === 'Stop') {
    if (binding) {
      const record = extractCompactRecord(input.last_assistant_message);
      if (record?.kind === 'baseline' && !saveCompactBaseline(root, binding, record)) {
        return { continue: true, systemMessage: 'Elegy compact session baseline ignored: a valid baseline already exists for this session.' };
      }
      if (record?.kind === 'update' && !saveCompactUpdate(root, binding, record)) {
        return { continue: true, systemMessage: 'Elegy compact session update ignored: no matching baseline or the wave transition was invalid.' };
      }
      if (!record && /<!--\s*ELEGY_SESSION_STATE\b/.test(String(input.last_assistant_message || ''))) {
        return { continue: true, systemMessage: 'Elegy compact session record ignored: hidden record was malformed or unsupported.' };
      }
      if (!record && hasLegacyGoalRecord(input.last_assistant_message)) {
        return { continue: true, systemMessage: 'Elegy legacy goal-session record ignored; establish a compact ELEGY_SESSION_STATE baseline to resume durable tracking.' };
      }
    }
    return { continue: true };
  }
  if (event === 'PreCompact') {
    if (binding) {
      const state = refreshCompactObservations(root, binding);
      recordPreCompact(root, binding, input.trigger || input.source, state ? 'compact-state-refreshed' : 'missing_or_invalid');
    }
    return { continue: true };
  }
  if (event === 'SessionStart') {
    if (input.source !== 'compact') return { continue: true };
    if (!binding) return { continue: true, systemMessage: unavailableWarning() };
    const context = compactContinuationContext(root, binding);
    if (!context) return { continue: true, systemMessage: 'Elegy compact session state unavailable; establish a fresh baseline after reconciling the conversation and repositories.' };
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
