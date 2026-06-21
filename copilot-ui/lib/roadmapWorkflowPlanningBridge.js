'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveElegyPlanningCliPath, commandExistsOnPath } = require('./elegyPlanningCliResolver');
const { readPlanningSession } = require('./planningSession');

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CLI_PATH = 'elegy-planning';
const DEFAULT_DB_FILENAME = 'planning.db';

function isExecutablePathConfigured(candidate) {
  const normalized = normalizeString(candidate);
  if (!normalized) {
    return false;
  }

  if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return true;
  }

  if (normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('~/')) {
    return true;
  }

  return /[/\\]/.test(normalized);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => normalizeString(entry)).filter(Boolean))];
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveStructuredState(artifact) {
  return isPlainObject(artifact && artifact.structuredState) ? artifact.structuredState : {};
}

function resolveBridgeMetadata(artifact) {
  const structuredState = resolveStructuredState(artifact);
  const metadata = isPlainObject(structuredState.metadata) ? structuredState.metadata : {};
  return isPlainObject(metadata.elegyPlanning) ? metadata.elegyPlanning : {};
}

function toTitleCase(token) {
  return normalizeString(token)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function roadmapIdToTitle(roadmapId) {
  const normalized = normalizeString(roadmapId);
  if (!normalized) {
    return '';
  }
  if (/^RM-/i.test(normalized)) {
    return toTitleCase(normalized.slice(3)) || normalized;
  }
  return toTitleCase(normalized) || normalized;
}

function deriveSeedStatus(status) {
  return normalizeString(status).toLowerCase() === 'draft' ? 'draft' : 'proposed';
}

function deriveWorkPointOrdering(workPointId) {
  const match = normalizeString(workPointId).match(/-(\d+)$/);
  if (!match) {
    return null;
  }
  const ordering = Number.parseInt(match[1], 10);
  return Number.isFinite(ordering) ? ordering : null;
}

function buildValidationExpectations(artifact) {
  const acceptance = resolveStructuredState(artifact).acceptance;
  const source = isPlainObject(acceptance) ? acceptance : {};
  return normalizeStringList([
    ...(Array.isArray(source.failedChecks) ? source.failedChecks : []),
    ...(Array.isArray(source.passedChecks) ? source.passedChecks : []),
  ]);
}

function buildSharedTags(artifact) {
  const tags = [
    'elegy-copilot',
    'roadmap-workflow',
  ];
  const repoId = normalizeString(artifact && artifact.repoId);
  const phase = normalizeString(artifact && artifact.phase);
  if (repoId) {
    tags.push(`repo:${repoId}`);
  }
  if (phase) {
    tags.push(`phase:${phase}`);
  }
  return tags;
}

function buildSyncSpecs(artifact) {
  const source = isPlainObject(artifact) ? artifact : {};
  const metadata = resolveBridgeMetadata(source);
  const roadmapId = normalizeString(metadata.roadmapId) || normalizeString(source.roadmapId);
  if (!roadmapId) {
    return null;
  }

  const roadmapTitle = normalizeString(metadata.roadmapTitle) || roadmapIdToTitle(roadmapId) || roadmapId;
  const goalId = normalizeString(metadata.goalId) || `ie-goal-${roadmapId}`;
  const sliceId = normalizeString(metadata.workPointId) || normalizeString(source.sliceId);
  const sharedTags = buildSharedTags(source);

  return {
    goal: {
      id: goalId,
      title: normalizeString(metadata.goalTitle) || `Workflow Goal for ${roadmapTitle}`,
      description:
        normalizeString(metadata.goalDescription)
        || `Compatibility goal seeded from elegy-copilot workflow artifacts for roadmap ${roadmapId}.`,
      acceptanceCriteria: [
        normalizeString(metadata.goalAcceptance)
        || `Durable roadmap ${roadmapId} exists in elegy-planning.`,
      ],
      rejectionCriteria: [
        normalizeString(metadata.goalRejection)
        || `Roadmap ${roadmapId} remains only in elegy-copilot workflow artifacts.`,
      ],
      status: deriveSeedStatus(source.status),
      tags: sharedTags,
    },
    roadmap: {
      id: roadmapId,
      goalId,
      title: roadmapTitle,
      summary:
        normalizeString(metadata.roadmapSummary)
        || `Compatibility roadmap seeded from elegy-copilot workflow artifact ${normalizeString(source.kind) || 'workflow-artifact'}.`,
      status: deriveSeedStatus(source.status),
      tags: sharedTags,
    },
    workPoint: sliceId
      ? {
          id: sliceId,
          title: normalizeString(metadata.workPointTitle) || `Workflow Item ${sliceId}`,
          summary:
            normalizeString(metadata.workPointSummary)
            || `Seeded from ${normalizeString(source.kind) || 'workflow-artifact'} in ${normalizeString(source.phase) || 'unknown'} phase.`,
          status: deriveSeedStatus(source.status),
          ordering: deriveWorkPointOrdering(sliceId),
          validationExpectations: buildValidationExpectations(source),
          tags: sharedTags,
        }
      : null,
  };
}

function resolveCommandInvocation(command, processObject = process) {
  const normalizedCommand = normalizeString(command);
  const platform = normalizeString(processObject && processObject.platform) || process.platform;

  if (platform === 'win32' && /\.(cmd|bat)$/i.test(normalizedCommand)) {
    return {
      command: normalizeString(processObject && processObject.env && processObject.env.ComSpec) || 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c', `"${normalizedCommand}"`],
    };
  }

  return {
    command: normalizedCommand,
    argsPrefix: [],
  };
}

function runCommand(config, args) {
  const execFile = typeof config.childProcess?.execFile === 'function'
    ? config.childProcess.execFile.bind(config.childProcess)
    : childProcess.execFile;
  const invocation = resolveCommandInvocation(config.cliPath, config.processObject);

  return new Promise((resolve) => {
    execFile(
      invocation.command,
      [...invocation.argsPrefix, ...args],
      {
        timeout: config.timeoutMs,
        windowsHide: true,
        env: config.env,
        cwd: config.cwd || undefined,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          error: error || null,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

function buildMachineArgs(dbPath, requestId, commandArgs, scope) {
  const args = [
    '--json',
    '--non-interactive',
    '--correlation-id',
    requestId,
    '--db',
    dbPath,
  ];
  if (scope) {
    args.push('--scope', scope);
  }
  args.push(...commandArgs);
  return args;
}

function normalizeMachineStatus(parsed) {
  return normalizeString(parsed && parsed.status).toLowerCase();
}

function extractValidationStatus(parsed) {
  const data = isPlainObject(parsed && parsed.data) ? parsed.data : {};
  const validation = isPlainObject(data.validation) ? data.validation : {};
  const status = normalizeString(validation.status).toLowerCase();
  return status || null;
}

function buildCommandFailure(parsed, commandArgs) {
  const machineStatus = normalizeMachineStatus(parsed) || 'error';
  const message = normalizeString(parsed && parsed.error)
    || `elegy-planning ${commandArgs.join(' ')} failed.`;
  const error = new Error(message);
  error.code = `elegy_planning_${machineStatus}`;
  error.parsed = parsed;
  error.commandArgs = commandArgs.slice();
  return error;
}

async function runMachineCommand(config, requestId, commandArgs) {
  const args = buildMachineArgs(config.dbPath, requestId, commandArgs, config.scope);
  const result = await runCommand(config, args);

  if (!normalizeString(result.stdout)) {
    const error = result.error || new Error(result.stderr || `elegy-planning ${commandArgs.join(' ')} failed.`);
    error.code = normalizeString(error.code) || 'elegy_planning_command_failed';
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.commandArgs = commandArgs.slice();
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    const error = new Error('Elegy planning command returned invalid JSON output.');
    error.code = 'elegy_planning_invalid_json';
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.commandArgs = commandArgs.slice();
    throw error;
  }

  return {
    parsed,
    commandArgs: commandArgs.slice(),
  };
}

function isNotFoundResponse(parsed) {
  const status = normalizeMachineStatus(parsed);
  const message = normalizeString(parsed && parsed.error);
  return status === 'invalid' && (/entity not found:/i.test(message) || /is in scope/i.test(message));
}

function buildOperation(entityType, entityId, action, parsed = null) {
  return {
    entityType,
    entityId,
    action,
    validationStatus: parsed ? extractValidationStatus(parsed) : null,
  };
}

async function readGoal(config, requestId, goalId) {
  const result = await runMachineCommand(config, requestId, ['goal', 'show', '--goal-id', goalId]);
  if (normalizeMachineStatus(result.parsed) === 'ok') {
    return { found: true, parsed: result.parsed };
  }
  if (isNotFoundResponse(result.parsed)) {
    return { found: false, parsed: result.parsed };
  }
  throw buildCommandFailure(result.parsed, result.commandArgs);
}

async function readRoadmap(config, requestId, roadmapId) {
  const result = await runMachineCommand(config, requestId, ['roadmap', 'show', '--roadmap-id', roadmapId]);
  if (normalizeMachineStatus(result.parsed) === 'ok') {
    return { found: true, parsed: result.parsed };
  }
  if (isNotFoundResponse(result.parsed)) {
    return { found: false, parsed: result.parsed };
  }
  throw buildCommandFailure(result.parsed, result.commandArgs);
}

function roadmapHasWorkPoint(roadmapView, workPointId) {
  const data = isPlainObject(roadmapView && roadmapView.data) ? roadmapView.data : {};
  const workPoints = Array.isArray(data.workPoints) ? data.workPoints : [];
  return workPoints.some((entry) => normalizeString(entry && entry.id) === workPointId);
}

function extractRoadmapGoalId(roadmapView) {
  const data = isPlainObject(roadmapView && roadmapView.data) ? roadmapView.data : {};
  const roadmap = isPlainObject(data.roadmap) ? data.roadmap : {};
  return normalizeString(roadmap.goalId) || null;
}

async function createGoal(config, requestId, spec) {
  const args = [
    'goal',
    'create',
    '--id',
    spec.id,
    '--title',
    spec.title,
    '--description',
    spec.description,
    '--status',
    spec.status,
  ];
  for (const acceptance of spec.acceptanceCriteria) {
    args.push('--acceptance', acceptance);
  }
  for (const rejection of spec.rejectionCriteria) {
    args.push('--rejection', rejection);
  }
  for (const tag of spec.tags) {
    args.push('--tag', tag);
  }

  const result = await runMachineCommand(config, requestId, args);
  if (normalizeMachineStatus(result.parsed) === 'ok') {
    return { parsed: result.parsed, action: 'created' };
  }

  const fallback = await readGoal(config, requestId, spec.id).catch(() => null);
  if (fallback && fallback.found) {
    return { parsed: fallback.parsed, action: 'verified' };
  }

  throw buildCommandFailure(result.parsed, result.commandArgs);
}

async function createRoadmap(config, requestId, spec) {
  const args = [
    'roadmap',
    'create',
    '--id',
    spec.id,
    '--goal-id',
    spec.goalId,
    '--title',
    spec.title,
    '--summary',
    spec.summary,
    '--status',
    spec.status,
  ];
  for (const tag of spec.tags) {
    args.push('--tag', tag);
  }

  const result = await runMachineCommand(config, requestId, args);
  if (normalizeMachineStatus(result.parsed) === 'ok') {
    return { parsed: result.parsed, action: 'created' };
  }

  const fallback = await readRoadmap(config, requestId, spec.id).catch(() => null);
  if (fallback && fallback.found) {
    return { parsed: fallback.parsed, action: 'verified' };
  }

  throw buildCommandFailure(result.parsed, result.commandArgs);
}

async function addWorkPoint(config, requestId, roadmapId, spec) {
  const args = [
    'roadmap',
    'add-work-point',
    '--id',
    spec.id,
    '--roadmap-id',
    roadmapId,
    '--title',
    spec.title,
    '--summary',
    spec.summary,
    '--status',
    spec.status,
  ];
  if (Number.isFinite(spec.ordering)) {
    args.push('--ordering', String(spec.ordering));
  }
  for (const validation of spec.validationExpectations) {
    args.push('--validation', validation);
  }
  for (const tag of spec.tags) {
    args.push('--tag', tag);
  }

  const result = await runMachineCommand(config, requestId, args);
  if (normalizeMachineStatus(result.parsed) === 'ok') {
    return { parsed: result.parsed, action: 'created' };
  }

  const fallback = await readRoadmap(config, requestId, roadmapId).catch(() => null);
  if (fallback && fallback.found && roadmapHasWorkPoint(fallback.parsed, spec.id)) {
    return { parsed: fallback.parsed, action: 'verified' };
  }

  throw buildCommandFailure(result.parsed, result.commandArgs);
}

function normalizeSyncError(error) {
  const parsed = error && error.parsed;
  return {
    code: normalizeString(error && error.code)
      || (parsed ? `elegy_planning_${normalizeMachineStatus(parsed) || 'error'}` : 'elegy_planning_sync_failed'),
    message: normalizeString(parsed && parsed.error)
      || normalizeString(error && error.message)
      || normalizeString(error && error.stderr)
      || normalizeString(error && error.stdout)
      || 'Elegy planning sync failed.',
  };
}

function buildMissingAuthorityFailure(reason, message) {
  return {
    status: 'failed_closed',
    attempted: 0,
    synced: 0,
    reason,
    errors: [{
      code: reason,
      message,
    }],
  };
}

function buildBridgeReadError(code, message, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function buildPlanningAuthorityStatus({ disabled, configured, config, configuredCliPath, configuredDbPath, commandLookupOptions, dbResolution }) {
  const cliPath = normalizeString(config && config.cliPath);
  const dbPath = normalizeString(config && config.dbPath);

  let cliBinaryExists = false;
  if (cliPath && isExecutablePathConfigured(cliPath)) {
    try {
      cliBinaryExists = fs.existsSync(cliPath);
    } catch {
      cliBinaryExists = false;
    }
  } else if (cliPath) {
    cliBinaryExists = commandExistsOnPath(cliPath, commandLookupOptions || {});
  }

  let code = 'planning_authority_ready';
  let ready = true;
  let message = 'elegy-planning authority is configured for live roadmap reads.';

  if (disabled) {
    ready = false;
    code = 'bridge_disabled';
    message = 'elegy-planning authority is disabled.';
  } else if (!configured) {
    ready = false;
    code = 'bridge_not_configured';
    message = 'elegy-planning authority is not configured.';
  } else if (!cliPath) {
    ready = false;
    code = 'cli_binary_not_found';
    message = 'elegy-planning CLI binary was not found. Set INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH or install elegy-planning to PATH.';
  } else if (!cliBinaryExists) {
    ready = false;
    code = 'cli_binary_not_found';
    message = `elegy-planning CLI binary not found at: ${cliPath}`;
  } else if (!dbPath) {
    ready = false;
    code = 'missing_db_path';
    message = 'elegy-planning authority requires a database path.';
  }

  const dbResolutionInfo = dbResolution
    ? {
        source: dbResolution.source || null,
        reason: dbResolution.reason || null,
        candidates: Array.isArray(dbResolution.candidates)
          ? dbResolution.candidates.map((c) => ({
              path: c.path,
              source: c.source,
              exists: c.exists,
              populated: c.populated,
            }))
          : [],
      }
    : null;

  return {
    ready,
    enabled: !disabled,
    configured,
    cliPath: cliPath || null,
    dbPath: dbPath || null,
    code,
    message,
    diagnostics: {
      configuredCliPath: configuredCliPath || null,
      configuredDbPath: configuredDbPath || null,
      defaultCliCommand: DEFAULT_CLI_PATH,
      defaultDbFileName: DEFAULT_DB_FILENAME,
    },
    dbResolution: dbResolutionInfo,
  };
}

function extractMachineData(parsed) {
  return isPlainObject(parsed && parsed.data) ? parsed.data : {};
}

function ensureReadableAuthority({ disabled, configured, config, planningAuthority }) {
  if (planningAuthority && planningAuthority.ready === false) {
    throw buildBridgeReadError(
      planningAuthority.code || 'bridge_not_configured',
      planningAuthority.message || 'elegy-planning authority is not ready for live roadmap reads.',
    );
  }

  if (disabled) {
    throw buildBridgeReadError(
      'bridge_disabled',
      'elegy-planning authority is disabled but required for live roadmap reads.',
    );
  }

  if (!configured) {
    throw buildBridgeReadError(
      'bridge_not_configured',
      'elegy-planning authority is not configured for live roadmap reads.',
    );
  }

   if (!normalizeString(config.cliPath)) {
    throw buildBridgeReadError(
      'missing_cli_path',
      'elegy-planning authority requires a CLI path.',
    );
  }

  if (!config.dbPath) {
    throw buildBridgeReadError(
      'missing_db_path',
      'elegy-planning authority requires a database path.',
    );
  }
}

function resolveReadRequestId(input = {}, fallback = 'planning-read') {
  return normalizeString(input.requestId)
    || normalizeString(input.correlationId)
    || normalizeString(input.roadmapId)
    || normalizeString(input.goalId)
    || normalizeString(input.planId)
    || fallback;
}

function makeScopedConfig(config, scopeOverride) {
  return {
    ...config,
    scope: scopeOverride || config.scope,
  };
}

async function scopeList(config, requestId) {
  const result = await runMachineCommand(config, requestId, ['scope', 'list']);
  if (normalizeMachineStatus(result.parsed) !== 'ok') {
    throw buildCommandFailure(result.parsed, result.commandArgs);
  }

  return {
    parsed: result.parsed,
    scopes: Array.isArray(extractMachineData(result.parsed).scopes)
      ? extractMachineData(result.parsed).scopes
      : [],
  };
}

function normalizeScopeEntry(entry) {
  if (!entry || typeof entry !== 'object') return { key: '', tags: [] };
  const key = normalizeString(entry.scopeKey || entry.key);
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
    : [];
  return { key, tags };
}

function deriveLabelTokens(repoLabels) {
  const tokens = new Set();
  for (const label of repoLabels) {
    const normalized = String(label).toLowerCase().trim();
    if (!normalized) continue;
    tokens.add(normalized);

    // Derive parts from hyphenated labels: "holon-repo" -> "holon", "repo"
    const parts = normalized.split(/[-_.]/).filter((p) => p.length > 0);
    for (const part of parts) {
      tokens.add(part);
    }

    // Derive basename from path-like labels
    if (normalized.includes('/') || normalized.includes('\\')) {
      const basename = normalized.replace(/\\/g, '/').split('/').filter(Boolean).pop();
      if (basename) {
        tokens.add(basename);
        const baseParts = basename.split(/[-_.]/).filter((p) => p.length > 0);
        for (const part of baseParts) {
          tokens.add(part);
        }
      }
    }
  }
  return [...tokens];
}

function scopeMatchesLabels(scopeEntry, labels) {
  if (!Array.isArray(labels) || labels.length === 0) {
    return false;
  }
  const derivedTokens = deriveLabelTokens(labels);
  const { key, tags } = normalizeScopeEntry(scopeEntry);
  if (key && derivedTokens.includes(key.toLowerCase())) {
    return true;
  }
  return derivedTokens.some((token) => tags.includes(token));
}

function dedupeEntitiesByScope(entities) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entities) {
    const scopeKey = normalizeString(entry && entry._scopeKey);
    const id = normalizeString(entry && entry.id);
    const key = scopeKey ? `${scopeKey}:${id}` : id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function resolveScopeToQuery(config, activeScope, repoLabels, scopeEntries) {
  const labels = Array.isArray(repoLabels) && repoLabels.length > 0
    ? repoLabels.map((l) => String(l).toLowerCase().trim()).filter(Boolean)
    : [];
  if (labels.length === 0) {
    return null;
  }

  const matchingScopes = [];
  const seenScopes = new Set();
  const activeKey = normalizeString(activeScope).toLowerCase() || 'default';

  // Label-matching scopes: collect all matches first
  const labelMatches = [];
  for (const rawEntry of scopeEntries) {
    const { key } = normalizeScopeEntry(rawEntry);
    if (!key) continue;
    if (scopeMatchesLabels(rawEntry, labels)) {
      labelMatches.push({ key, tags: rawEntry.tags || [], isActive: key === activeKey || (!activeScope && key === 'default') });
    }
  }

  // Active/default scope first if it's a label match, otherwise first label match
  const activeMatch = labelMatches.find((m) => m.isActive);
  if (activeMatch && !seenScopes.has(activeMatch.key)) {
    seenScopes.add(activeMatch.key);
    matchingScopes.push({ key: activeMatch.key, tags: activeMatch.tags });
  }

  // Remaining label-matching scopes
  for (const match of labelMatches) {
    if (match.isActive || seenScopes.has(match.key)) continue;
    seenScopes.add(match.key);
    matchingScopes.push({ key: match.key, tags: match.tags });
  }

  // If no label matches at all, return null to trigger fallback DB trial.
  // (Active/default scope baseline is NOT included when it doesn't match labels.)
  return matchingScopes.length > 0 ? matchingScopes : null;
}

async function listRoadmapsMultiScope(config, requestId, scopesToQuery) {
  const allRoadmaps = [];

  for (const scopeEntry of scopesToQuery) {
    const scopedConfig = makeScopedConfig(config, scopeEntry.key);
    try {
      const result = await listRoadmaps(scopedConfig, requestId);
      for (const roadmap of result.roadmaps) {
        allRoadmaps.push({ ...roadmap, _scopeKey: scopeEntry.key });
      }
    } catch (_err) {
      // Skip scopes that fail; continue with remaining
    }
  }

  return {
    roadmaps: dedupeEntitiesByScope(allRoadmaps),
  };
}

async function listGoalsMultiScope(config, requestId, scopesToQuery) {
  const allGoals = [];

  for (const scopeEntry of scopesToQuery) {
    const scopedConfig = makeScopedConfig(config, scopeEntry.key);
    try {
      const result = await listGoals(scopedConfig, requestId);
      for (const goal of result.goals) {
        allGoals.push({ ...goal, _scopeKey: scopeEntry.key });
      }
    } catch (_err) {
      // Skip scopes that fail; continue with remaining
    }
  }

  return {
    goals: dedupeEntitiesByScope(allGoals),
  };
}

async function listPlansMultiScope(config, requestId, scopesToQuery) {
  const allPlans = [];

  for (const scopeEntry of scopesToQuery) {
    const scopedConfig = makeScopedConfig(config, scopeEntry.key);
    try {
      const result = await listPlans(scopedConfig, requestId);
      for (const plan of result.plans) {
        allPlans.push({ ...plan, _scopeKey: scopeEntry.key });
      }
    } catch (_err) {
      // Skip scopes that fail; continue with remaining
    }
  }

  return {
    plans: dedupeEntitiesByScope(allPlans),
  };
}

/**
 * Try to find an entity across multiple scopes and fallback DB candidates.
 * Returns { found, parsed, _scopeKey } on success, or null if not found in any scope.
 */
async function tryFindEntityMultiScope(config, scope, requestId, repoLabels, dbResolution, findFn) {
  if (repoLabels.length === 0) return null;

  // Try primary DB first
  try {
    const scopes = await scopeList(config, requestId);
    const scopesToQuery = resolveScopeToQuery(config, scope, repoLabels, scopes.scopes);
    if (scopesToQuery && scopesToQuery.length > 0) {
      for (const scopeEntry of scopesToQuery) {
        const scopedConfig = makeScopedConfig(config, scopeEntry.key);
        try {
          const result = await findFn(scopedConfig, requestId);
          if (result && result.found) {
            return { ...result, _scopeKey: scopeEntry.key };
          }
        } catch (_err) { /* try next scope */ }
      }
    }
  } catch (_scopeErr) { /* scope list failed; fall through */ }

  // Try fallback DB candidates
  const fallbackCandidates = (dbResolution && dbResolution.candidates || [])
    .filter((c) => c.populated && c.path !== config.dbPath);
  for (const candidate of fallbackCandidates) {
    try {
      const fallbackConfig = { ...config, dbPath: candidate.path };
      const scopes = await scopeList(fallbackConfig, requestId);
      const scopesToQuery = resolveScopeToQuery(fallbackConfig, scope, repoLabels, scopes.scopes);
      if (scopesToQuery && scopesToQuery.length > 0) {
        for (const scopeEntry of scopesToQuery) {
          const scopedConfig = makeScopedConfig(fallbackConfig, scopeEntry.key);
          try {
            const result = await findFn(scopedConfig, requestId);
            if (result && result.found) {
              return { ...result, _scopeKey: scopeEntry.key };
            }
          } catch (_err) { /* try next scope */ }
        }
      }
    } catch (_fallbackErr) { /* try next candidate */ }
  }

  return null;
}

async function listRoadmaps(config, requestId) {
  const result = await runMachineCommand(config, requestId, ['roadmap', 'list']);
  if (normalizeMachineStatus(result.parsed) !== 'ok') {
    throw buildCommandFailure(result.parsed, result.commandArgs);
  }

  return {
    parsed: result.parsed,
    roadmaps: Array.isArray(extractMachineData(result.parsed).roadmaps)
      ? extractMachineData(result.parsed).roadmaps
      : [],
  };
}

async function listGoals(config, requestId) {
  const result = await runMachineCommand(config, requestId, ['goal', 'list']);
  if (normalizeMachineStatus(result.parsed) !== 'ok') {
    throw buildCommandFailure(result.parsed, result.commandArgs);
  }

  return {
    parsed: result.parsed,
    goals: Array.isArray(extractMachineData(result.parsed).goals)
      ? extractMachineData(result.parsed).goals
      : [],
  };
}

async function listPlans(config, requestId) {
  const result = await runMachineCommand(config, requestId, ['plan', 'list']);
  if (normalizeMachineStatus(result.parsed) !== 'ok') {
    throw buildCommandFailure(result.parsed, result.commandArgs);
  }

  return {
    parsed: result.parsed,
    plans: Array.isArray(extractMachineData(result.parsed).plans)
      ? extractMachineData(result.parsed).plans
      : [],
  };
}

async function listTodos(config, requestId) {
  const result = await runMachineCommand(config, requestId, ['todo', 'list']);
  if (normalizeMachineStatus(result.parsed) !== 'ok') {
    throw buildCommandFailure(result.parsed, result.commandArgs);
  }

  return {
    parsed: result.parsed,
    todos: Array.isArray(extractMachineData(result.parsed).todos)
      ? extractMachineData(result.parsed).todos
      : [],
  };
}

async function readPlan(config, requestId, planId) {
  const result = await runMachineCommand(config, requestId, ['plan', 'show', '--plan-id', planId]);
  if (normalizeMachineStatus(result.parsed) === 'ok') {
    return { found: true, parsed: result.parsed };
  }
  if (isNotFoundResponse(result.parsed)) {
    return { found: false, parsed: result.parsed };
  }
  throw buildCommandFailure(result.parsed, result.commandArgs);
}

function resolvePlanningDbPath(options = {}) {
  const env = options.env || {};
  const elegyHome = normalizeString(options.elegyHome);
  const homedir = normalizeString(options.homedir) || os.homedir();
  const pathModule = options.pathModule || path;
  const fsModule = options.fsModule || fs;

  const explicitPath = normalizeString(options.dbPath);

  const candidates = [];

  function pushCandidate(source, candidatePath) {
    const resolved = candidatePath ? pathModule.resolve(candidatePath) : '';
    if (resolved && candidates.some((c) => pathModule.resolve(c.path) === resolved)) {
      return;
    }
    const entry = { path: candidatePath, source, exists: false, populated: false };
    if (candidatePath) {
      try {
        if (fsModule.existsSync(candidatePath)) {
          entry.exists = true;
          entry.populated = fsModule.statSync(candidatePath).size > 0;
        }
      } catch {
        // keep defaults
      }
    }
    candidates.push(entry);
  }

  // 1. Explicit path (direct option only)
  if (explicitPath) {
    pushCandidate('explicit', explicitPath);
  }

  // 2. ~/.elegy/planning.db (canonical default)
  if (homedir) {
    pushCandidate('home-elegy', pathModule.join(homedir, '.elegy', DEFAULT_DB_FILENAME));
  }

  // 3. <elegyHome>/planning.db, only when the supplied root is an Elegy home.
  if (elegyHome && pathModule.basename(pathModule.resolve(elegyHome)).toLowerCase() === '.elegy') {
    pushCandidate('elegy-home', pathModule.join(elegyHome, DEFAULT_DB_FILENAME));
  }

  // Selection: prefer explicit if populated, otherwise most populated candidate
  let selected = null;
  let reason = '';

  // Prefer explicit populated
  const explicitCand = candidates.find((c) => c.source === 'explicit' && c.populated);
  if (explicitCand) {
    selected = explicitCand;
    reason = `selected explicit database (populated)`;
  } else {
    const populated = candidates.filter((c) => c.populated);
    if (populated.length > 0) {
      selected = populated[0];
      reason = `selected ${selected.source} database (populated)`;
    } else {
      const existing = candidates.filter((c) => c.exists);
      if (existing.length > 0) {
        selected = existing[0];
        reason = `selected ${selected.source} database (exists, not populated)`;
      } else if (candidates.length > 0) {
        selected = candidates[0];
        reason = `default ${selected.source} (does not exist)`;
      }
    }
  }

  return {
    dbPath: selected ? selected.path : (explicitPath || ''),
    source: selected ? selected.source : 'none',
    reason,
    candidates,
  };
}

function createRoadmapWorkflowPlanningBridge(options = {}) {
  const processObject = options.processObject && typeof options.processObject === 'object'
    ? options.processObject
    : process;
  const env = options.env && typeof options.env === 'object'
    ? options.env
    : (processObject.env && typeof processObject.env === 'object' ? processObject.env : process.env);
  const pathModule = options.pathModule && typeof options.pathModule.join === 'function'
    ? options.pathModule
    : path;
  const elegyHome = normalizeString(options.elegyHome);

  const configuredCliPath = normalizeString(options.cliPath || env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH);

  const dbResolution = resolvePlanningDbPath({
    dbPath: options.dbPath,
    elegyHome,
    homedir: options.homedir,
    pathModule,
    fsModule: options.fsModule,
    env,
  });
  let configuredDbPath = dbResolution.dbPath;

  // Resolve active planning scope from session sidecar
  // (runs after DB fallback so it can use the final resolved path)
  let scope = '';
  try {
    const planningSession = readPlanningSession(env, {
      homedir: os.homedir(),
      dbPath: configuredDbPath,
    });
    if (planningSession && planningSession.sidecar && planningSession.sidecar.scope) {
      scope = String(planningSession.sidecar.scope).trim();
    }
  } catch (_err) {
    // scope remains empty; CLI will use its default scope
  }

  const commandLookupPlatform = normalizeString(options.platform)
    || normalizeString(processObject && processObject.platform)
    || process.platform;
  const commandLookupSpawnSync = typeof options.spawnSyncImpl === 'function'
    ? options.spawnSyncImpl
    : (typeof options.childProcess?.spawnSync === 'function' ? options.childProcess.spawnSync.bind(options.childProcess) : undefined);
  const commandLookupOptions = {
    env,
    platform: commandLookupPlatform,
    spawnSyncImpl: commandLookupSpawnSync,
  };
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Number(options.timeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const disabled = options.enabled === false || normalizeString(env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DISABLED) === '1';

  const resolvedCliPath = resolveElegyPlanningCliPath({
    cliPath: configuredCliPath,
    runtimeRoot: normalizeString(options.runtimeRoot) || normalizeString(env.INSTRUCTION_ENGINE_RUNTIME_ROOT),
    elegyHome,
    env,
    platform: commandLookupPlatform,
    spawnSyncImpl: commandLookupSpawnSync,
  });

  const configured = options.enabled === true
    || normalizeString(env.INSTRUCTION_ENGINE_ELEGY_PLANNING_ENABLED) === '1'
    || Boolean(configuredCliPath)
    || Boolean(normalizeString(options.dbPath));

  const config = {
    childProcess: options.childProcess,
    processObject,
    env,
    cliPath: resolvedCliPath || configuredCliPath || '',
    dbPath: configuredDbPath,
    scope,
    cwd: elegyHome || undefined,
    timeoutMs,
  };
  const planningAuthority = buildPlanningAuthorityStatus({
    disabled,
    configured,
    config,
    configuredCliPath: resolvedCliPath || configuredCliPath,
    configuredDbPath,
    commandLookupOptions,
    dbResolution,
  });

  return {
    getStatus() {
      return {
        ...planningAuthority,
      };
    },
    async listGoals(input = {}) {
      ensureReadableAuthority({ disabled, configured, config, planningAuthority });
      const requestId = resolveReadRequestId(input, 'goal-list');

      const repoLabels = Array.isArray(input.repoLabels) && input.repoLabels.length > 0
        ? input.repoLabels
        : (normalizeString(input.repoLabel) ? [normalizeString(input.repoLabel)] : []);

      let scopeDiscoveryOk = false;

      if (repoLabels.length > 0) {
        try {
          const scopes = await scopeList(config, requestId);
          scopeDiscoveryOk = true;
          const scopesToQuery = resolveScopeToQuery(config, scope, repoLabels, scopes.scopes);
          if (scopesToQuery && scopesToQuery.length > 0) {
            const result = await listGoalsMultiScope(config, requestId, scopesToQuery);
            if (result.goals.length > 0) {
              return result;
            }
          }
        } catch (_scopeErr) {
          // scope list failed; fall through
        }

        const fallbackCandidates = (dbResolution && dbResolution.candidates || [])
          .filter((c) => c.populated && c.path !== config.dbPath);
        for (const candidate of fallbackCandidates) {
          try {
            const fallbackConfig = { ...config, dbPath: candidate.path };
            const scopes = await scopeList(fallbackConfig, requestId);
            scopeDiscoveryOk = true;
            const scopesToQuery = resolveScopeToQuery(fallbackConfig, scope, repoLabels, scopes.scopes);
            if (scopesToQuery && scopesToQuery.length > 0) {
              const result = await listGoalsMultiScope(fallbackConfig, requestId, scopesToQuery);
              if (result.goals.length > 0) {
                return result;
              }
            }
          } catch (_fallbackErr) {
            // try next candidate
          }
        }

        if (scopeDiscoveryOk) {
          return { goals: [] };
        }
      }

      return listGoals(config, requestId);
    },
    async listRoadmaps(input = {}) {
      ensureReadableAuthority({ disabled, configured, config, planningAuthority });
      const requestId = resolveReadRequestId(input, 'roadmap-list');

      const repoLabels = Array.isArray(input.repoLabels) && input.repoLabels.length > 0
        ? input.repoLabels
        : (normalizeString(input.repoLabel) ? [normalizeString(input.repoLabel)] : []);

      let scopeDiscoveryOk = false;

      if (repoLabels.length > 0) {
        // Try primary DB first
        try {
          const scopes = await scopeList(config, requestId);
          scopeDiscoveryOk = true;
          const scopesToQuery = resolveScopeToQuery(config, scope, repoLabels, scopes.scopes);
          if (scopesToQuery && scopesToQuery.length > 0) {
            const result = await listRoadmapsMultiScope(config, requestId, scopesToQuery);
            if (result.roadmaps.length > 0) {
              return result;
            }
          }
        } catch (_scopeErr) {
          // scope list failed; fall through
        }

        // Try fallback DB candidates (e.g. canonical ~/.elegy/planning.db after an explicit DB override)
        const fallbackCandidates = (dbResolution && dbResolution.candidates || [])
          .filter((c) => c.populated && c.path !== config.dbPath);
        for (const candidate of fallbackCandidates) {
          try {
            const fallbackConfig = { ...config, dbPath: candidate.path };
            const scopes = await scopeList(fallbackConfig, requestId);
            scopeDiscoveryOk = true;
            const scopesToQuery = resolveScopeToQuery(fallbackConfig, scope, repoLabels, scopes.scopes);
            if (scopesToQuery && scopesToQuery.length > 0) {
              const result = await listRoadmapsMultiScope(fallbackConfig, requestId, scopesToQuery);
              if (result.roadmaps.length > 0) {
                return result;
              }
            }
          } catch (_fallbackErr) {
            // try next candidate
          }
        }

        if (scopeDiscoveryOk) {
          return { roadmaps: [] };
        }
      }

      return listRoadmaps(config, requestId);
    },
    async showRoadmap(input = {}) {
      ensureReadableAuthority({ disabled, configured, config, planningAuthority });
      const roadmapId = normalizeString(input.roadmapId);
      if (!roadmapId) {
        throw buildBridgeReadError('missing_roadmap_id', 'roadmapId is required to load a roadmap.', 400);
      }

      const requestId = resolveReadRequestId(input, roadmapId);
      const repoLabels = Array.isArray(input.repoLabels) && input.repoLabels.length > 0
        ? input.repoLabels
        : (normalizeString(input.repoLabel) ? [normalizeString(input.repoLabel)] : []);

      let result = null;

      // Try multi-scope resolution when repo labels are present
      if (repoLabels.length > 0) {
        result = await tryFindEntityMultiScope(config, scope, requestId, repoLabels, dbResolution,
          (cfg, rid) => readRoadmap(cfg, rid, roadmapId));
      }

      // Fall back to active scope query
      if (!result) {
        result = await readRoadmap(config, requestId, roadmapId);
        if (result && result.found) {
          result._scopeKey = scope || 'default';
        } else {
          throw buildBridgeReadError('roadmap_not_found', `elegy-planning roadmap ${roadmapId} was not found.`, 404);
        }
      }

      const data = extractMachineData(result.parsed);
      return {
        parsed: result.parsed,
        roadmap: isPlainObject(data.roadmap) ? data.roadmap : {},
        sections: Array.isArray(data.sections) ? data.sections : [],
        workPoints: Array.isArray(data.workPoints) ? data.workPoints : [],
        validation: isPlainObject(data.validation) ? data.validation : {},
        _scopeKey: result._scopeKey || undefined,
      };
    },
    async showGoal(input = {}) {
      ensureReadableAuthority({ disabled, configured, config, planningAuthority });
      const goalId = normalizeString(input.goalId);
      if (!goalId) {
        throw buildBridgeReadError('missing_goal_id', 'goalId is required to load a goal.', 400);
      }

      const requestId = resolveReadRequestId(input, goalId);
      const repoLabels = Array.isArray(input.repoLabels) && input.repoLabels.length > 0
        ? input.repoLabels
        : (normalizeString(input.repoLabel) ? [normalizeString(input.repoLabel)] : []);

      let result = null;

      if (repoLabels.length > 0) {
        result = await tryFindEntityMultiScope(config, scope, requestId, repoLabels, dbResolution,
          (cfg, rid) => readGoal(cfg, rid, goalId));
      }

      if (!result) {
        result = await readGoal(config, requestId, goalId);
        if (result && result.found) {
          result._scopeKey = scope || 'default';
        } else {
          throw buildBridgeReadError('goal_not_found', `elegy-planning goal ${goalId} was not found.`, 404);
        }
      }

      const data = extractMachineData(result.parsed);
      return {
        parsed: result.parsed,
        goal: isPlainObject(data.goal) ? data.goal : {},
        roadmaps: Array.isArray(data.roadmaps) ? data.roadmaps : [],
        validation: isPlainObject(data.validation) ? data.validation : {},
        _scopeKey: result._scopeKey || undefined,
      };
    },
    async listPlans(input = {}) {
      ensureReadableAuthority({ disabled, configured, config, planningAuthority });
      const requestId = resolveReadRequestId(input, 'plan-list');

      const repoLabels = Array.isArray(input.repoLabels) && input.repoLabels.length > 0
        ? input.repoLabels
        : (normalizeString(input.repoLabel) ? [normalizeString(input.repoLabel)] : []);

      if (repoLabels.length > 0) {
        // Try primary DB first
        try {
          const scopes = await scopeList(config, requestId);
          const scopesToQuery = resolveScopeToQuery(config, scope, repoLabels, scopes.scopes);
          if (scopesToQuery && scopesToQuery.length > 0) {
            const result = await listPlansMultiScope(config, requestId, scopesToQuery);
            if (result.plans.length > 0) {
              return result;
            }
          }
        } catch (_scopeErr) {
          // scope list failed; fall through
        }

        // Try fallback DB candidates (e.g. canonical ~/.elegy/planning.db after an explicit DB override)
        const fallbackCandidates = (dbResolution && dbResolution.candidates || [])
          .filter((c) => c.populated && c.path !== config.dbPath);
        for (const candidate of fallbackCandidates) {
          try {
            const fallbackConfig = { ...config, dbPath: candidate.path };
            const scopes = await scopeList(fallbackConfig, requestId);
            const scopesToQuery = resolveScopeToQuery(fallbackConfig, scope, repoLabels, scopes.scopes);
            if (scopesToQuery && scopesToQuery.length > 0) {
              const result = await listPlansMultiScope(fallbackConfig, requestId, scopesToQuery);
              if (result.plans.length > 0) {
                return result;
              }
            }
          } catch (_fallbackErr) {
            // try next candidate
          }
        }
      }

      return listPlans(config, requestId);
    },
    async showPlan(input = {}) {
      ensureReadableAuthority({ disabled, configured, config, planningAuthority });
      const planId = normalizeString(input.planId);
      if (!planId) {
        throw buildBridgeReadError('missing_plan_id', 'planId is required to load a plan.', 400);
      }

      const requestId = resolveReadRequestId(input, planId);
      const repoLabels = Array.isArray(input.repoLabels) && input.repoLabels.length > 0
        ? input.repoLabels
        : (normalizeString(input.repoLabel) ? [normalizeString(input.repoLabel)] : []);

      let result = null;

      if (repoLabels.length > 0) {
        result = await tryFindEntityMultiScope(config, scope, requestId, repoLabels, dbResolution,
          (cfg, rid) => readPlan(cfg, rid, planId));
      }

      if (!result) {
        result = await readPlan(config, requestId, planId);
        if (result && result.found) {
          result._scopeKey = scope || 'default';
        } else {
          throw buildBridgeReadError('plan_not_found', `elegy-planning plan ${planId} was not found.`, 404);
        }
      }

      const data = extractMachineData(result.parsed);
      return {
        parsed: result.parsed,
        plan: isPlainObject(data.plan) ? data.plan : {},
        todos: Array.isArray(data.todos) ? data.todos : [],
        reviewPoints: Array.isArray(data.reviewPoints) ? data.reviewPoints : [],
        validation: isPlainObject(data.validation) ? data.validation : {},
        _scopeKey: result._scopeKey || undefined,
      };
    },
    async listTodos(input = {}) {
      ensureReadableAuthority({ disabled, configured, config, planningAuthority });
      const requestId = resolveReadRequestId(input, 'todo-list');
      return listTodos(config, requestId);
    },
    async listScopes(input = {}) {
      ensureReadableAuthority({ disabled, configured, config, planningAuthority });
      const requestId = resolveReadRequestId(input, 'scope-list');
      return scopeList(config, requestId);
    },
    async persistArtifact(artifact, input = {}) {
      if (planningAuthority.ready === false) {
        return buildMissingAuthorityFailure(
          planningAuthority.code || 'bridge_not_configured',
          planningAuthority.message || 'elegy-planning authority is not ready for workflow artifact persistence.',
        );
      }

      if (disabled) {
        return buildMissingAuthorityFailure(
          'bridge_disabled',
          'elegy-planning authority is disabled but required for workflow artifact persistence.',
        );
      }

      if (!configured) {
        return buildMissingAuthorityFailure(
          'bridge_not_configured',
          'elegy-planning authority is not configured for workflow artifact persistence.',
        );
      }

      if (!normalizeString(config.cliPath)) {
        return buildMissingAuthorityFailure(
          'missing_cli_path',
          'elegy-planning authority requires a CLI path.',
        );
      }

      if (!config.dbPath) {
        return buildMissingAuthorityFailure(
          'missing_db_path',
          'elegy-planning authority requires a database path.',
        );
      }

      const specs = buildSyncSpecs(artifact);
      if (!specs) {
        return {
          status: 'skipped',
          attempted: 0,
          synced: 0,
          reason: 'missing_roadmap_id',
        };
      }

      const requestId = normalizeString(input.requestId)
        || normalizeString(artifact && artifact.artifactId)
        || normalizeString(artifact && artifact.sessionId)
        || specs.roadmap.id;
      const operations = [];
      let attempted = 0;
      const entities = {
        goalId: specs.goal.id,
        roadmapId: specs.roadmap.id,
        ...(specs.workPoint ? { workPointId: specs.workPoint.id } : {}),
      };

      try {
        attempted += 1;
        const roadmapState = await readRoadmap(config, requestId, specs.roadmap.id);
        let roadmapView = roadmapState.found ? roadmapState.parsed : null;
        if (roadmapState.found) {
          entities.goalId = extractRoadmapGoalId(roadmapState.parsed) || entities.goalId;
          operations.push(buildOperation('roadmap', specs.roadmap.id, 'verified', roadmapState.parsed));
        } else {
          attempted += 1;
          const goalState = await readGoal(config, requestId, specs.goal.id);
          if (goalState.found) {
            operations.push(buildOperation('goal', specs.goal.id, 'verified', goalState.parsed));
          } else {
            const createdGoal = await createGoal(config, requestId, specs.goal);
            operations.push(buildOperation('goal', specs.goal.id, createdGoal.action, createdGoal.parsed));
          }

          const createdRoadmap = await createRoadmap(config, requestId, specs.roadmap);
          operations.push(buildOperation('roadmap', specs.roadmap.id, createdRoadmap.action, createdRoadmap.parsed));
          roadmapView = null;
        }

        if (specs.workPoint) {
          attempted += 1;
          if (roadmapView && roadmapHasWorkPoint(roadmapView, specs.workPoint.id)) {
            operations.push(buildOperation('work-point', specs.workPoint.id, 'verified'));
          } else {
            const createdWorkPoint = await addWorkPoint(config, requestId, specs.roadmap.id, specs.workPoint);
            operations.push(buildOperation('work-point', specs.workPoint.id, createdWorkPoint.action, createdWorkPoint.parsed));
          }
        }

        const finalRoadmap = await readRoadmap(config, requestId, specs.roadmap.id);
        if (!finalRoadmap.found) {
          const error = new Error(`elegy-planning roadmap ${specs.roadmap.id} was not available after sync.`);
          error.code = 'elegy_planning_sync_incomplete';
          throw error;
        }
        entities.goalId = extractRoadmapGoalId(finalRoadmap.parsed) || entities.goalId;

        return {
          status: 'synced',
          attempted,
          synced: operations.length,
          validationStatus: extractValidationStatus(finalRoadmap.parsed),
          entities,
          operations,
        };
      } catch (error) {
        return {
          status: 'failed_open',
          attempted,
          synced: operations.length,
          entities,
          operations,
          errors: [normalizeSyncError(error)],
        };
      }
    },
  };
}

module.exports = {
  createRoadmapWorkflowPlanningBridge,
  resolvePlanningDbPath,
};
