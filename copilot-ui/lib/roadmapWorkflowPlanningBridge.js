'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CLI_PATH = 'elegy-planning';
const DEFAULT_DB_FILENAME = 'elegy-planning.db';

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
    'instruction-engine',
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
        || `Compatibility goal seeded from instruction-engine workflow artifacts for roadmap ${roadmapId}.`,
      acceptanceCriteria: [
        normalizeString(metadata.goalAcceptance)
        || `Durable roadmap ${roadmapId} exists in elegy-planning.`,
      ],
      rejectionCriteria: [
        normalizeString(metadata.goalRejection)
        || `Roadmap ${roadmapId} remains only in instruction-engine workflow artifacts.`,
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
        || `Compatibility roadmap seeded from instruction-engine workflow artifact ${normalizeString(source.kind) || 'workflow-artifact'}.`,
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

function buildMachineArgs(dbPath, requestId, commandArgs) {
  return [
    '--json',
    '--non-interactive',
    '--correlation-id',
    requestId,
    '--db',
    dbPath,
    ...commandArgs,
  ];
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
  const args = buildMachineArgs(config.dbPath, requestId, commandArgs);
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
  return normalizeMachineStatus(parsed) === 'invalid'
    && /entity not found:/i.test(normalizeString(parsed && parsed.error));
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

function extractMachineData(parsed) {
  return isPlainObject(parsed && parsed.data) ? parsed.data : {};
}

function ensureReadableAuthority({ disabled, configured, config }) {
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
  const copilotHome = normalizeString(options.copilotHome);
  const configuredCliPath = normalizeString(options.cliPath || env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH);
  const configuredDbPath = normalizeString(options.dbPath || env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH)
    || (copilotHome ? pathModule.join(copilotHome, DEFAULT_DB_FILENAME) : '');
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Number(options.timeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const disabled = options.enabled === false || normalizeString(env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DISABLED) === '1';
  const configured = options.enabled === true
    || normalizeString(env.INSTRUCTION_ENGINE_ELEGY_PLANNING_ENABLED) === '1'
    || Boolean(configuredCliPath)
    || Boolean(normalizeString(options.dbPath || env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH));
  const config = {
    childProcess: options.childProcess,
    processObject,
    env,
    cliPath: configuredCliPath || DEFAULT_CLI_PATH,
    dbPath: configuredDbPath,
    cwd: copilotHome || undefined,
    timeoutMs,
  };

  return {
    async listRoadmaps(input = {}) {
      ensureReadableAuthority({ disabled, configured, config });
      const requestId = resolveReadRequestId(input, 'roadmap-list');
      return listRoadmaps(config, requestId);
    },
    async showRoadmap(input = {}) {
      ensureReadableAuthority({ disabled, configured, config });
      const roadmapId = normalizeString(input.roadmapId);
      if (!roadmapId) {
        throw buildBridgeReadError('missing_roadmap_id', 'roadmapId is required to load a roadmap.', 400);
      }

      const requestId = resolveReadRequestId(input, roadmapId);
      const result = await readRoadmap(config, requestId, roadmapId);
      if (!result.found) {
        throw buildBridgeReadError('roadmap_not_found', `elegy-planning roadmap ${roadmapId} was not found.`, 404);
      }

      const data = extractMachineData(result.parsed);
      return {
        parsed: result.parsed,
        roadmap: isPlainObject(data.roadmap) ? data.roadmap : {},
        sections: Array.isArray(data.sections) ? data.sections : [],
        workPoints: Array.isArray(data.workPoints) ? data.workPoints : [],
        validation: isPlainObject(data.validation) ? data.validation : {},
      };
    },
    async showGoal(input = {}) {
      ensureReadableAuthority({ disabled, configured, config });
      const goalId = normalizeString(input.goalId);
      if (!goalId) {
        throw buildBridgeReadError('missing_goal_id', 'goalId is required to load a goal.', 400);
      }

      const requestId = resolveReadRequestId(input, goalId);
      const result = await readGoal(config, requestId, goalId);
      if (!result.found) {
        throw buildBridgeReadError('goal_not_found', `elegy-planning goal ${goalId} was not found.`, 404);
      }

      const data = extractMachineData(result.parsed);
      return {
        parsed: result.parsed,
        goal: isPlainObject(data.goal) ? data.goal : {},
        roadmaps: Array.isArray(data.roadmaps) ? data.roadmaps : [],
        validation: isPlainObject(data.validation) ? data.validation : {},
      };
    },
    async listPlans(input = {}) {
      ensureReadableAuthority({ disabled, configured, config });
      const requestId = resolveReadRequestId(input, 'plan-list');
      return listPlans(config, requestId);
    },
    async showPlan(input = {}) {
      ensureReadableAuthority({ disabled, configured, config });
      const planId = normalizeString(input.planId);
      if (!planId) {
        throw buildBridgeReadError('missing_plan_id', 'planId is required to load a plan.', 400);
      }

      const requestId = resolveReadRequestId(input, planId);
      const result = await readPlan(config, requestId, planId);
      if (!result.found) {
        throw buildBridgeReadError('plan_not_found', `elegy-planning plan ${planId} was not found.`, 404);
      }

      const data = extractMachineData(result.parsed);
      return {
        parsed: result.parsed,
        plan: isPlainObject(data.plan) ? data.plan : {},
        todos: Array.isArray(data.todos) ? data.todos : [],
        reviewPoints: Array.isArray(data.reviewPoints) ? data.reviewPoints : [],
        validation: isPlainObject(data.validation) ? data.validation : {},
      };
    },
    async listTodos(input = {}) {
      ensureReadableAuthority({ disabled, configured, config });
      const requestId = resolveReadRequestId(input, 'todo-list');
      return listTodos(config, requestId);
    },
    async persistArtifact(artifact, input = {}) {
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
};
