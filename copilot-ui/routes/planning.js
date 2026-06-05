'use strict';

const {
  PLANNING_API_CONTRACT_VERSION: SHARED_PLANNING_API_CONTRACT_VERSION,
  computeRoadmapWorkflowArtifactChecksum,
  CONTINUATION_PACKAGE_CONTRACT_VERSION,
  parseRoadmapWorkflowMarkdownArtifact,
} = require('@elegy-copilot/contracts');
const { buildSessionOrchestrationProjection } = require('../lib/runtimeContracts');
const continuationPackagesLib = require('../lib/continuationPackages');
const path = require('path');
const fs = require('fs');

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeStringList(values) {
  return uniqueStrings(Array.isArray(values) ? values : []);
}

function normalizePathForPlanningComparison(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return '';
  }

  return normalized.replace(/[\\/]+/g, '/').toLowerCase();
}

function buildPlanningRepoSelection(repoId, repoPath, repoLabel) {
  const normalizedRepoId = normalizeOptionalString(repoId) || '';
  const normalizedRepoPath = normalizeOptionalString(repoPath) || '';
  const normalizedRepoLabel = normalizeOptionalString(repoLabel)
    || normalizedRepoId
    || normalizedRepoPath
    || '';

  if (!normalizedRepoId && !normalizedRepoPath && !normalizedRepoLabel) {
    return null;
  }

  return {
    repoId: normalizedRepoId,
    repoPath: normalizedRepoPath,
    repoLabel: normalizedRepoLabel,
  };
}

function resolvePlanningLiveRepoSelection(u) {
  const repoId = normalizeOptionalString(u.searchParams.get('repoId'));
  const repoPath = normalizeOptionalString(u.searchParams.get('repoPath'));
  const repoLabel = normalizeOptionalString(u.searchParams.get('repoLabel')) || repoId || repoPath;
  return buildPlanningRepoSelection(repoId, repoPath, repoLabel);
}

function getPlanningEntityTags(entity) {
  return normalizeStringList(entity && entity.tags);
}

function resolveWorktreeParentRepo(repo) {
  if (!repo || !repo.repoPath) return null;

  const gitPath = path.join(repo.repoPath, '.git');
  try {
    const stat = fs.statSync(gitPath);
    if (!stat.isFile()) return null;

    const content = fs.readFileSync(gitPath, 'utf8').trim();
    const match = content.match(/^gitdir:\s*(.+)$/im);
    if (!match) return null;

    const gitDir = path.resolve(repo.repoPath, match[1].trim());
    const worktreeIdx = gitDir.replace(/\\/g, '/').lastIndexOf('/worktrees/');
    if (worktreeIdx === -1) return null;

    const parentGitDir = gitDir.substring(0, worktreeIdx);
    const parentRepoRoot = path.resolve(parentGitDir, '..');
    const normalized = parentRepoRoot.replace(/\\/g, '/').toLowerCase();
    const hash = require('crypto').createHash('sha256').update(normalized, 'utf8').digest('hex');

    return {
      repoId: hash.slice(0, 12),
      repoPath: parentRepoRoot,
      repoLabel: path.basename(parentRepoRoot),
    };
  } catch {
    return null;
  }
}

function planningEntityMatchesRepoSelection(entity, repo, parentRepo, parentTags) {
  const selection = repo && typeof repo === 'object' ? repo : null;
  const repoId = normalizeOptionalString(selection && selection.repoId);
  const repoPath = normalizePathForPlanningComparison(selection && selection.repoPath);
  const repoLabel = normalizeOptionalString(selection && selection.repoLabel);
  if (!repoId && !repoPath && !repoLabel) {
    return true;
  }

  const record = entity && typeof entity === 'object' ? entity : {};
  const tags = getPlanningEntityTags(record).map((tag) => tag.toLowerCase());
  if (repoId && tags.includes(`repo:${repoId}`.toLowerCase())) {
    return true;
  }

  const entityRepoId = normalizeOptionalString(record.repoId)
    || normalizeOptionalString(record.repositoryId)
    || normalizeOptionalString(record.repo && record.repo.repoId);
  if (repoId && entityRepoId && entityRepoId.toLowerCase() === repoId.toLowerCase()) {
    return true;
  }

  const entityRepoPath = normalizePathForPlanningComparison(record.repoPath)
    || normalizePathForPlanningComparison(record.repositoryPath)
    || normalizePathForPlanningComparison(record.repo && record.repo.repoPath);
  if (repoPath && entityRepoPath && entityRepoPath === repoPath) {
    return true;
  }

  const entityRepoLabel = normalizeOptionalString(record.repoLabel)
    || normalizeOptionalString(record.repositoryLabel)
    || normalizeOptionalString(record.repo && record.repo.repoLabel);
  if (repoLabel && entityRepoLabel && entityRepoLabel.toLowerCase() === repoLabel.toLowerCase()) {
    return true;
  }

  if (parentTags) {
    const inheritedLower = new Set(Array.isArray(parentTags) ? parentTags.map((t) => String(t).toLowerCase()) : []);
    if (repoId && inheritedLower.has(`repo:${repoId}`.toLowerCase())) {
      return true;
    }
    if (repoLabel && inheritedLower.has(`repo:${repoLabel}`.toLowerCase())) {
      return true;
    }
  }

  if (parentRepo) {
    return planningEntityMatchesRepoSelection(entity, parentRepo, null, null);
  }

  return false;
}

function planningEntityMatchesRepo(entity, repoId) {
  return planningEntityMatchesRepoSelection(entity, buildPlanningRepoSelection(repoId, '', ''));
}

function resolveRepoParentWorktree(repo) {
  if (!repo || !repo.repoPath) return null;
  const parent = resolveWorktreeParentRepo(repo);
  return parent ? buildPlanningRepoSelection(parent.repoId, parent.repoPath, parent.repoLabel) : null;
}

async function loadGoalTagsForRoadmaps(roadmaps, bridge) {
  const items = Array.isArray(roadmaps) ? roadmaps : [];
  if (items.length === 0 || !bridge || typeof bridge.showGoal !== 'function') {
    return new Map();
  }

  const uniqueGoalIds = new Set(
    items.map((r) => normalizeOptionalString(r && r.goalId)).filter(Boolean),
  );

  const goalTagCache = new Map();
  const goalPromises = [];

  for (const goalId of uniqueGoalIds) {
    goalPromises.push(
      bridge.showGoal({ goalId, requestId: `planning-inherit-${goalId}` })
        .catch(() => null),
    );
  }

  const results = await Promise.all(goalPromises);
  const goalIds = Array.from(uniqueGoalIds);
  for (let i = 0; i < goalIds.length; i++) {
    const goalId = goalIds[i];
    const response = results[i];
    const goal = response && response.goal;
    const tags = goal && Array.isArray(goal.tags) ? goal.tags : [];
    goalTagCache.set(goalId, tags.length ? tags : null);
  }

  const roadmapTagMap = new Map();
  for (const roadmap of items) {
    const goalId = normalizeOptionalString(roadmap.goalId);
    const parentTags = goalId ? goalTagCache.get(goalId) : null;
    if (parentTags) {
      roadmapTagMap.set(roadmap.id, parentTags);
    }
  }

  return roadmapTagMap;
}

const ROADMAP_INHERIT_GOAL_SCOPE_ACTIVE =
  process.env.PLANNING_ROADMAP_INHERIT_GOAL_SCOPE !== 'false';

function filterPlanningLiveRoadmaps(roadmaps, repo, opts = {}) {
  const items = Array.isArray(roadmaps) ? roadmaps : [];
  if (items.length === 0) return [];
  const parentRepo = resolveRepoParentWorktree(repo);
  const parentTagsMap = opts && opts.parentTagsMap instanceof Map ? opts.parentTagsMap : null;
  const includeUnscoped = opts && opts.includeUnscoped === true;

  return items.filter((roadmap) => {
    // Direct match: roadmap's own tags worktree parent
    if (planningEntityMatchesRepoSelection(roadmap, repo, parentRepo, null)) {
      return true;
    }

    // Inherited match: parent goal tags
    if (ROADMAP_INHERIT_GOAL_SCOPE_ACTIVE && parentTagsMap) {
      const goalTags = parentTagsMap.get(roadmap.id);
      if (goalTags && planningEntityMatchesRepoSelection(roadmap, repo, null, goalTags)) {
        return true;
      }
    }

    // includeUnscoped: roadmaps with no repo tags pass through
    if (includeUnscoped) {
      const tags = getPlanningEntityTags(roadmap).map((t) => t.toLowerCase());
      const hasRepoTags = tags.some((t) => t.startsWith('repo:'));
      if (!hasRepoTags) {
        return true;
      }
    }

    return false;
  });
}

function filterPlanningLivePlans(plans, filters = {}) {
  const repo = buildPlanningRepoSelection(filters.repoId, filters.repoPath, filters.repoLabel);
  const parentRepo = resolveRepoParentWorktree(repo);
  const goalId = normalizeOptionalString(filters.goalId);
  const roadmapId = normalizeOptionalString(filters.roadmapId);
  const parentTags = Array.isArray(filters.parentTags) ? filters.parentTags : null;

  return (Array.isArray(plans) ? plans : []).filter((plan) => {
    if (!planningEntityMatchesRepoSelection(plan, repo, parentRepo, parentTags)) {
      return false;
    }
    if (goalId && normalizeOptionalString(plan && plan.goalId) !== goalId) {
      return false;
    }
    if (roadmapId && normalizeOptionalString(plan && plan.roadmapId) !== roadmapId) {
      return false;
    }
    return true;
  });
}

function filterPlanningLiveTodos(todos, filters = {}) {
  const repo = buildPlanningRepoSelection(filters.repoId, filters.repoPath, filters.repoLabel);
  const parentRepo = resolveRepoParentWorktree(repo);
  const planId = normalizeOptionalString(filters.planId);
  const workPointId = normalizeOptionalString(filters.workPointId);
  const allowedPlanIds = filters.allowedPlanIds instanceof Set ? filters.allowedPlanIds : null;
  const parentTags = Array.isArray(filters.parentTags) ? filters.parentTags : null;

  return (Array.isArray(todos) ? todos : []).filter((todo) => {
    if (!planningEntityMatchesRepoSelection(todo, repo, parentRepo, parentTags)) {
      return false;
    }

    const todoPlanId = normalizeOptionalString(todo && todo.planId);
    if (planId && todoPlanId !== planId) {
      return false;
    }
    if (allowedPlanIds && !allowedPlanIds.has(todoPlanId || '')) {
      return false;
    }
    if (workPointId && normalizeOptionalString(todo && todo.workPointId) !== workPointId) {
      return false;
    }
    return true;
  });
}

function buildPlanningLiveReadFailure(error, PLANNING_API_CONTRACT_VERSION, kind, fallbackMessage) {
  const statusCode = Number.isFinite(error && error.statusCode)
    ? Number(error.statusCode)
    : 503;
  const code = normalizeOptionalString(error && error.code) || 'planning_live_authority_read_failed';
  const message = normalizeOptionalString(error && error.message) || fallbackMessage;

  return {
    statusCode,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind,
      deterministic: true,
      error: message,
      code,
      reason: code,
    },
  };
}

function buildPlanningLiveRouteError(code, message, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requirePlanningLiveAuthorityBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') {
    throw buildPlanningLiveRouteError(
      'planning_live_authority_bridge_missing',
      'elegy-planning authority bridge is required for live planning reads.',
    );
  }

  return bridge;
}

function assertPlanningEntityInRepo(entity, repo, entityLabel, parentTags) {
  if (planningEntityMatchesRepoSelection(entity, repo, null, parentTags)) {
    return;
  }

  throw buildPlanningLiveRouteError(
    'planning_live_repo_scope_mismatch',
    `${entityLabel} is outside the selected repo scope.`,
    404,
  );
}

function resolvePlanningLiveRequestId(req, fallback) {
  return normalizeOptionalString(req && req.headers && req.headers['x-request-id']) || fallback;
}

function buildWorkflowArtifactMemorySyncFailure(error) {
  return {
    status: 'failed_open',
    attempted: 0,
    synced: 0,
    errors: [{
      code: typeof error?.code === 'string' && error.code.trim()
        ? error.code.trim()
        : 'planning_workflow_memory_sync_failed',
      message: String(error && error.message ? error.message : error),
    }],
  };
}

function buildWorkflowArtifactPlanningSyncFailure(error) {
  return {
    status: 'failed_closed',
    attempted: 0,
    synced: 0,
    errors: [{
      code: typeof error?.code === 'string' && error.code.trim()
        ? error.code.trim()
        : 'planning_workflow_authority_sync_failed',
      message: String(error && error.message ? error.message : error),
    }],
  };
}

async function syncPlanningWorkflowArtifactMemory(bridge, artifact) {
  if (!bridge || typeof bridge.persistArtifact !== 'function') {
    return null;
  }

  try {
    return await bridge.persistArtifact(artifact);
  } catch (error) {
    return buildWorkflowArtifactMemorySyncFailure(error);
  }
}

async function syncPlanningWorkflowArtifactAuthority(bridge, artifact, options = {}) {
  if (!bridge || typeof bridge.persistArtifact !== 'function') {
    return buildWorkflowArtifactPlanningSyncFailure({
      code: 'planning_workflow_authority_bridge_missing',
      message: 'elegy-planning authority bridge is required for workflow artifact persistence.',
    });
  }

  try {
    return await bridge.persistArtifact(artifact, options);
  } catch (error) {
    return buildWorkflowArtifactPlanningSyncFailure(error);
  }
}

function buildPlanningTaskBoardItems(taskRecords) {
  return (Array.isArray(taskRecords) ? taskRecords : []).map((task) => ({
    taskId: task.taskId,
    title: task.title || null,
    status: task.status || null,
    ownerSessionId: task.ownerSessionId || null,
    activeActorId: task.activeActorId || null,
    activeActorLabel: task.activeActorLabel || null,
    workflow: task.workflow || {},
    worktree: task.worktree || {},
    linkedPlanning: task.linkedPlanning || {},
    durablePath: task.durablePath || null,
    projection: {
      durableStore: 'repo-state',
    },
  }));
}

function handlePlanningTaskBoard(ctx, deps) {
  const { res, u, copilotHome, copilotHomeAbs } = ctx;
  const { sendJson, sessions, PLANNING_API_CONTRACT_VERSION } = deps;
  const repoId = normalizeOptionalString(u.searchParams.get('repoId'));
  const repoPath = normalizeOptionalString(u.searchParams.get('repoPath'));
  const repoLabel = normalizeOptionalString(u.searchParams.get('repoLabel')) || repoId || repoPath;

  if (!repoId) {
    sendJson(res, 400, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.task-board',
      deterministic: true,
      error: {
        code: 'planning_repo_id_required',
        reason: 'planning_repo_id_required',
        message: 'repoId is required to load the Planning task board.',
      },
    });
    return;
  }

  const taskRecords = sessions && typeof sessions.listRepoStateTasks === 'function'
    ? sessions.listRepoStateTasks(copilotHomeAbs || copilotHome, repoId, { maxEntries: 500 })
    : [];
  const taskItems = buildPlanningTaskBoardItems(taskRecords);
  const projection = buildSessionOrchestrationProjection({
    metadata: {
      repo: {
        repoId,
        repoPath,
        repoLabel,
        source: 'planning',
      },
    },
    actors: [],
    taskItems,
  });

  projection.actors = {
    items: [],
    activeActorId: null,
  };

  sendJson(res, 200, {
    contractVersion: PLANNING_API_CONTRACT_VERSION,
    kind: 'planning.task-board',
    deterministic: true,
    projection,
  });
}

function handlePlanningLiveRoadmapsList(ctx, deps) {
  const { req, res, u } = ctx;
  const {
    sendJson,
    roadmapWorkflowPlanningBridge,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;
  const repo = resolvePlanningLiveRepoSelection(u);

  Promise.resolve()
    .then(async () => {
      const bridge = requirePlanningLiveAuthorityBridge(roadmapWorkflowPlanningBridge);
      if (typeof bridge.listRoadmaps !== 'function') {
        throw buildPlanningLiveRouteError(
          'planning_live_roadmaps_unavailable',
          'elegy-planning authority bridge does not expose roadmap listing.',
        );
      }

      const response = await bridge.listRoadmaps({
        requestId: resolvePlanningLiveRequestId(
          req,
          (repo && (repo.repoId || repo.repoPath || repo.repoLabel)) || 'planning-live-roadmaps',
        ),
      });
      const includeUnscoped = String(u.searchParams.get('includeUnscoped') || '').toLowerCase() === 'true';
      const rawRoadmaps = response && response.roadmaps;
      const goalTagMap = await loadGoalTagsForRoadmaps(rawRoadmaps, bridge);
      const roadmaps = filterPlanningLiveRoadmaps(rawRoadmaps, repo, {
        parentTagsMap: goalTagMap,
        includeUnscoped,
      });

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.live.roadmaps',
        deterministic: true,
        repo,
        count: roadmaps.length,
        roadmaps,
      });
    })
    .catch((error) => {
      const failure = buildPlanningLiveReadFailure(
        error,
        PLANNING_API_CONTRACT_VERSION,
        'planning.live.roadmaps',
        'Unable to load live roadmaps from elegy-planning.',
      );
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handlePlanningLiveRoadmapRead(ctx, deps) {
  const { req, res, u, match } = ctx;
  const {
    sendJson,
    roadmapWorkflowPlanningBridge,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;
  const roadmapId = decodeURIComponent((match && match[1]) || '').trim();
  const repo = resolvePlanningLiveRepoSelection(u);

  Promise.resolve()
    .then(async () => {
      if (!roadmapId) {
        throw buildPlanningLiveRouteError('missing_roadmap_id', 'roadmapId is required to load a live roadmap.', 400);
      }

      const bridge = requirePlanningLiveAuthorityBridge(roadmapWorkflowPlanningBridge);
      if (typeof bridge.showRoadmap !== 'function') {
        throw buildPlanningLiveRouteError(
          'planning_live_roadmap_unavailable',
          'elegy-planning authority bridge does not expose roadmap detail reads.',
        );
      }

      const response = await bridge.showRoadmap({
        roadmapId,
        requestId: resolvePlanningLiveRequestId(req, roadmapId),
      });
      assertPlanningEntityInRepo(response && response.roadmap, repo, `Roadmap ${roadmapId}`);

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.live.roadmap',
        deterministic: true,
        repo,
        roadmap: response && response.roadmap ? response.roadmap : {},
        sections: Array.isArray(response && response.sections) ? response.sections : [],
        workPoints: Array.isArray(response && response.workPoints) ? response.workPoints : [],
        validation: response && response.validation && typeof response.validation === 'object'
          ? response.validation
          : {},
      });
    })
    .catch((error) => {
      const failure = buildPlanningLiveReadFailure(
        error,
        PLANNING_API_CONTRACT_VERSION,
        'planning.live.roadmap',
        `Unable to load live roadmap ${roadmapId || '(unknown)'} from elegy-planning.`,
      );
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handlePlanningLiveGoalRead(ctx, deps) {
  const { req, res, u, match } = ctx;
  const {
    sendJson,
    roadmapWorkflowPlanningBridge,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;
  const goalId = decodeURIComponent((match && match[1]) || '').trim();
  const repo = resolvePlanningLiveRepoSelection(u);

  Promise.resolve()
    .then(async () => {
      if (!goalId) {
        throw buildPlanningLiveRouteError('missing_goal_id', 'goalId is required to load a live goal.', 400);
      }

      const bridge = requirePlanningLiveAuthorityBridge(roadmapWorkflowPlanningBridge);
      if (typeof bridge.showGoal !== 'function') {
        throw buildPlanningLiveRouteError(
          'planning_live_goal_unavailable',
          'elegy-planning authority bridge does not expose goal detail reads.',
        );
      }

      const response = await bridge.showGoal({
        goalId,
        requestId: resolvePlanningLiveRequestId(req, goalId),
      });
      assertPlanningEntityInRepo(response && response.goal, repo, `Goal ${goalId}`);
      const roadmaps = filterPlanningLiveRoadmaps(response && response.roadmaps, repo);

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.live.goal',
        deterministic: true,
        repo,
        goal: response && response.goal ? response.goal : {},
        roadmaps,
        validation: response && response.validation && typeof response.validation === 'object'
          ? response.validation
          : {},
      });
    })
    .catch((error) => {
      const failure = buildPlanningLiveReadFailure(
        error,
        PLANNING_API_CONTRACT_VERSION,
        'planning.live.goal',
        `Unable to load live goal ${goalId || '(unknown)'} from elegy-planning.`,
      );
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handlePlanningLivePlansList(ctx, deps) {
  const { req, res, u } = ctx;
  const {
    sendJson,
    roadmapWorkflowPlanningBridge,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;
  const repo = resolvePlanningLiveRepoSelection(u);
  const goalId = normalizeOptionalString(u.searchParams.get('goalId'));
  const roadmapId = normalizeOptionalString(u.searchParams.get('roadmapId'));

  Promise.resolve()
    .then(async () => {
      const bridge = requirePlanningLiveAuthorityBridge(roadmapWorkflowPlanningBridge);
      if (typeof bridge.listPlans !== 'function') {
        throw buildPlanningLiveRouteError(
          'planning_live_plans_unavailable',
          'elegy-planning authority bridge does not expose plan listing.',
        );
      }

      const response = await bridge.listPlans({
        requestId: resolvePlanningLiveRequestId(
          req,
          roadmapId || goalId || (repo && (repo.repoId || repo.repoPath || repo.repoLabel)) || 'planning-live-plans',
        ),
      });
      const plans = filterPlanningLivePlans(response && response.plans, {
        repoId: repo && repo.repoId,
        repoPath: repo && repo.repoPath,
        repoLabel: repo && repo.repoLabel,
        goalId,
        roadmapId,
      });

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.live.plans',
        deterministic: true,
        repo,
        filters: {
          goalId: goalId || '',
          roadmapId: roadmapId || '',
        },
        count: plans.length,
        plans,
      });
    })
    .catch((error) => {
      const failure = buildPlanningLiveReadFailure(
        error,
        PLANNING_API_CONTRACT_VERSION,
        'planning.live.plans',
        'Unable to load live plans from elegy-planning.',
      );
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handlePlanningLivePlanRead(ctx, deps) {
  const { req, res, u, match } = ctx;
  const {
    sendJson,
    roadmapWorkflowPlanningBridge,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;
  const planId = decodeURIComponent((match && match[1]) || '').trim();
  const repo = resolvePlanningLiveRepoSelection(u);

  Promise.resolve()
    .then(async () => {
      if (!planId) {
        throw buildPlanningLiveRouteError('missing_plan_id', 'planId is required to load a live plan.', 400);
      }

      const bridge = requirePlanningLiveAuthorityBridge(roadmapWorkflowPlanningBridge);
      if (typeof bridge.showPlan !== 'function') {
        throw buildPlanningLiveRouteError(
          'planning_live_plan_unavailable',
          'elegy-planning authority bridge does not expose plan detail reads.',
        );
      }

      const response = await bridge.showPlan({
        planId,
        requestId: resolvePlanningLiveRequestId(req, planId),
      });
      assertPlanningEntityInRepo(response && response.plan, repo, `Plan ${planId}`);

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.live.plan',
        deterministic: true,
        repo,
        plan: response && response.plan ? response.plan : {},
        todos: Array.isArray(response && response.todos) ? response.todos : [],
        reviewPoints: Array.isArray(response && response.reviewPoints) ? response.reviewPoints : [],
        validation: response && response.validation && typeof response.validation === 'object'
          ? response.validation
          : {},
      });
    })
    .catch((error) => {
      const failure = buildPlanningLiveReadFailure(
        error,
        PLANNING_API_CONTRACT_VERSION,
        'planning.live.plan',
        `Unable to load live plan ${planId || '(unknown)'} from elegy-planning.`,
      );
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handlePlanningLiveTodosList(ctx, deps) {
  const { req, res, u } = ctx;
  const {
    sendJson,
    roadmapWorkflowPlanningBridge,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;
  const repo = resolvePlanningLiveRepoSelection(u);
  const planId = normalizeOptionalString(u.searchParams.get('planId'));
  const roadmapId = normalizeOptionalString(u.searchParams.get('roadmapId'));
  const workPointId = normalizeOptionalString(u.searchParams.get('workPointId'));

  Promise.resolve()
    .then(async () => {
      const bridge = requirePlanningLiveAuthorityBridge(roadmapWorkflowPlanningBridge);
      if (typeof bridge.listTodos !== 'function') {
        throw buildPlanningLiveRouteError(
          'planning_live_todos_unavailable',
          'elegy-planning authority bridge does not expose todo listing.',
        );
      }

      let allowedPlanIds = null;
      if (roadmapId) {
        if (typeof bridge.listPlans !== 'function') {
          throw buildPlanningLiveRouteError(
            'planning_live_plans_unavailable',
            'elegy-planning authority bridge does not expose plan listing for roadmap todo filters.',
          );
        }

        const plansResponse = await bridge.listPlans({
          requestId: resolvePlanningLiveRequestId(req, roadmapId),
        });
        const plans = filterPlanningLivePlans(plansResponse && plansResponse.plans, {
          repoId: repo && repo.repoId,
          repoPath: repo && repo.repoPath,
          repoLabel: repo && repo.repoLabel,
          roadmapId,
        });
        allowedPlanIds = new Set(
          plans
            .map((plan) => normalizeOptionalString(plan && plan.id))
            .filter(Boolean),
        );
      }

      const response = await bridge.listTodos({
        requestId: resolvePlanningLiveRequestId(
          req,
          workPointId || planId || roadmapId || (repo && (repo.repoId || repo.repoPath || repo.repoLabel)) || 'planning-live-todos',
        ),
      });
      const todos = filterPlanningLiveTodos(response && response.todos, {
        repoId: repo && repo.repoId,
        repoPath: repo && repo.repoPath,
        repoLabel: repo && repo.repoLabel,
        planId,
        workPointId,
        allowedPlanIds,
      });

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.live.todos',
        deterministic: true,
        repo,
        filters: {
          roadmapId: roadmapId || '',
          planId: planId || '',
          workPointId: workPointId || '',
        },
        count: todos.length,
        todos,
      });
    })
    .catch((error) => {
      const failure = buildPlanningLiveReadFailure(
        error,
        PLANNING_API_CONTRACT_VERSION,
        'planning.live.todos',
        'Unable to load live todos from elegy-planning.',
      );
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handlePlanningPersistenceInit(ctx, deps) {
  const { req, res, planningPersistenceConfig, planningPersistenceState } = ctx;
  const {
    sendJson,
    initializePlanningPersistenceAuthority,
    PLANNING_API_CONTRACT_VERSION,
    buildPlanningPersistenceHealthEnvelope,
    getPlanningPersistenceHealth,
  } = deps;

  initializePlanningPersistenceAuthority(planningPersistenceConfig, planningPersistenceState)
    .then((result) => sendJson(res, result.statusCode, result.body))
    .catch((error) => sendJson(res, 503, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.init',
      deterministic: true,
      ready: false,
      initialized: false,
      error: {
        code: 'planning_persistence_init_failed',
        reason: 'planning_persistence_init_failed',
        message: String(error && error.message ? error.message : error),
      },
      errors: [{
        code: 'planning_persistence_init_failed',
        reason: 'planning_persistence_init_failed',
        message: String(error && error.message ? error.message : error),
      }],
      planningPersistence: buildPlanningPersistenceHealthEnvelope(
        getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
      ),
    }));
}

function handlePlanningPersistenceCorruptionScan(ctx, deps) {
  const { req, res, pathname, planningPersistenceConfig, planningPersistenceState } = ctx;
  const {
    sendJson,
    readJsonBody,
    resolvePlanningPersistenceOperationClient,
    scanPlanningPersistenceCorruption,
    applyPlanningPersistenceCorruptionScan,
    PLANNING_API_CONTRACT_VERSION,
    buildPlanningPersistenceHealthEnvelope,
    getPlanningPersistenceHealth,
  } = deps;

  readJsonBody(req)
    .then(async () => {
      const operationAuthority = resolvePlanningPersistenceOperationClient({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
      });

      if (!operationAuthority.ok) {
        sendJson(res, operationAuthority.failure.statusCode, operationAuthority.failure.body);
        return;
      }

      const result = await scanPlanningPersistenceCorruption(operationAuthority.authority.client);
      const corruption = applyPlanningPersistenceCorruptionScan(planningPersistenceState, result);

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.persistence.corruption.scan',
        deterministic: true,
        code: corruption.code,
        reason: corruption.reason,
        blocked: corruption.blocked,
        recoveryRequired: corruption.recoveryRequired,
        result,
        planningPersistence: buildPlanningPersistenceHealthEnvelope(
          getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
        ),
        corruption,
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.corruption.scan',
      deterministic: true,
      error: 'Planning persistence corruption scan failed',
      code: 'planning_persistence_corruption_scan_failed',
      reason: 'planning_persistence_corruption_scan_failed',
      detail: String(e && e.message ? e.message : e),
    }));
}

function handlePlanningPersistenceRetention(ctx, deps) {
  const { req, res, pathname, planningPersistenceConfig, planningPersistenceState } = ctx;
  const {
    sendJson,
    readJsonBody,
    resolvePlanningPersistenceOperationClient,
    buildPlanningPersistenceWriteBlockedFailure,
    runPlanningRetention,
    scanPlanningPersistenceCorruption,
    applyPlanningPersistenceCorruptionScan,
    PLANNING_API_CONTRACT_VERSION,
    buildPlanningPersistenceHealthEnvelope,
    getPlanningPersistenceHealth,
    buildPlanningPersistenceCorruptionEnvelope,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const operationAuthority = resolvePlanningPersistenceOperationClient({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
      });

      if (!operationAuthority.ok) {
        sendJson(res, operationAuthority.failure.statusCode, operationAuthority.failure.body);
        return;
      }

      const modeToken = String(payload.mode || '').trim().toLowerCase();
      const mode = modeToken === 'execute' ? 'execute' : 'dry-run';
      if (mode === 'execute') {
        const blockedFailure = buildPlanningPersistenceWriteBlockedFailure(
          pathname,
          req.method,
          planningPersistenceConfig,
          planningPersistenceState,
          operationAuthority.authority,
        );
        if (blockedFailure) {
          sendJson(res, blockedFailure.statusCode, blockedFailure.body);
          return;
        }
      }

      const result = await runPlanningRetention(operationAuthority.authority.client, {
        ...payload,
        mode,
        nowMs: Date.now(),
      });

      if (mode === 'execute') {
        const postScan = await scanPlanningPersistenceCorruption(operationAuthority.authority.client);
        applyPlanningPersistenceCorruptionScan(planningPersistenceState, postScan);
      }

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.persistence.retention',
        deterministic: true,
        code: mode === 'execute'
          ? 'planning_persistence_retention_executed'
          : 'planning_persistence_retention_dry_run',
        reason: mode === 'execute'
          ? 'planning_persistence_retention_executed'
          : 'planning_persistence_retention_dry_run',
        result,
        planningPersistence: buildPlanningPersistenceHealthEnvelope(
          getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
        ),
        corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.retention',
      deterministic: true,
      error: 'Planning persistence retention failed',
      code: 'planning_persistence_retention_failed',
      reason: 'planning_persistence_retention_failed',
      detail: String(e && e.message ? e.message : e),
    }));
}

function handlePlanningPersistenceExport(ctx, deps) {
  const { req, res, pathname, planningPersistenceConfig, planningPersistenceState } = ctx;
  const {
    sendJson,
    readJsonBody,
    resolvePlanningPersistenceOperationClient,
    exportPlanningPersistenceSnapshot,
    PLANNING_API_CONTRACT_VERSION,
    buildPlanningPersistenceHealthEnvelope,
    getPlanningPersistenceHealth,
    buildPlanningPersistenceCorruptionEnvelope,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const operationAuthority = resolvePlanningPersistenceOperationClient({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
      });

      if (!operationAuthority.ok) {
        sendJson(res, operationAuthority.failure.statusCode, operationAuthority.failure.body);
        return;
      }

      const result = await exportPlanningPersistenceSnapshot(operationAuthority.authority.client, {
        exportedAt: payload.exportedAt,
      });

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.persistence.export',
        deterministic: true,
        code: 'planning_persistence_export_ready',
        reason: 'planning_persistence_export_ready',
        result,
        planningPersistence: buildPlanningPersistenceHealthEnvelope(
          getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
        ),
        corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.export',
      deterministic: true,
      error: 'Planning persistence export failed',
      code: 'planning_persistence_export_failed',
      reason: 'planning_persistence_export_failed',
      detail: String(e && e.message ? e.message : e),
    }));
}

function handlePlanningPersistenceImport(ctx, deps) {
  const { req, res, pathname, planningPersistenceConfig, planningPersistenceState } = ctx;
  const {
    sendJson,
    readJsonBody,
    resolvePlanningPersistenceOperationClient,
    buildPlanningPersistenceWriteBlockedFailure,
    importPlanningPersistenceSnapshot,
    scanPlanningPersistenceCorruption,
    applyPlanningPersistenceCorruptionScan,
    PLANNING_API_CONTRACT_VERSION,
    buildPlanningPersistenceHealthEnvelope,
    getPlanningPersistenceHealth,
    buildPlanningPersistenceCorruptionEnvelope,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const operationAuthority = resolvePlanningPersistenceOperationClient({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
      });

      if (!operationAuthority.ok) {
        sendJson(res, operationAuthority.failure.statusCode, operationAuthority.failure.body);
        return;
      }

      const blockedFailure = buildPlanningPersistenceWriteBlockedFailure(
        pathname,
        req.method,
        planningPersistenceConfig,
        planningPersistenceState,
        operationAuthority.authority,
      );
      if (blockedFailure) {
        sendJson(res, blockedFailure.statusCode, blockedFailure.body);
        return;
      }

      const result = await importPlanningPersistenceSnapshot(operationAuthority.authority.client, payload);
      if (!result.ok) {
        const statusCode = result.error && (
          result.error.code === 'planning_persistence_import_invalid_record'
          || result.error.code === 'planning_persistence_import_conflicting_duplicate'
        )
          ? 400
          : 503;

        sendJson(res, statusCode, {
          contractVersion: PLANNING_API_CONTRACT_VERSION,
          kind: 'planning.persistence.import',
          deterministic: true,
          error: 'Planning persistence import failed',
          code: result.error && result.error.code
            ? result.error.code
            : 'planning_persistence_import_failed',
          reason: result.error && result.error.reason
            ? result.error.reason
            : 'planning_persistence_import_failed',
          detail: result.error || null,
          planningPersistence: buildPlanningPersistenceHealthEnvelope(
            getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
          ),
          corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
        });
        return;
      }

      const postScan = await scanPlanningPersistenceCorruption(operationAuthority.authority.client);
      applyPlanningPersistenceCorruptionScan(planningPersistenceState, postScan);

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.persistence.import',
        deterministic: true,
        code: 'planning_persistence_import_applied',
        reason: 'planning_persistence_import_applied',
        result,
        planningPersistence: buildPlanningPersistenceHealthEnvelope(
          getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
        ),
        corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.import',
      deterministic: true,
      error: 'Planning persistence import failed',
      code: 'planning_persistence_import_failed',
      reason: 'planning_persistence_import_failed',
      detail: String(e && e.message ? e.message : e),
    }));
}

function handlePlanningRecordsCreate(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    readJsonBody,
    buildPlanningRequestContext,
    resolveRequestIdempotencyKey,
    acquirePlanningMutationRouteLock,
    hydratePlanningProjectionFromPersistence,
    resolveExpectedPlanningVersion,
    evaluatePlanningRouteOptimisticConcurrency,
    createPlanningRecordOperation,
    persistPlanningRecordToAuthority,
    evictPlanningIdempotencyEntry,
    releasePlanningRouteLock,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);
      const recordInput = payload.record && typeof payload.record === 'object' ? payload.record : payload;
      const idempotencyKey = resolveRequestIdempotencyKey(req, payload);

      const routeLock = acquirePlanningMutationRouteLock({
        planningApiState,
        pathname,
        method: req.method,
        context,
        idempotencyKey,
        requestId: req.headers['x-request-id'],
        nowMs: Date.now(),
      });

      if (!routeLock.ok) {
        sendJson(res, routeLock.statusCode, routeLock.body);
        return;
      }

      try {
        const projectionSync = await hydratePlanningProjectionFromPersistence({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
          planningApiState,
          context,
        });

        if (!projectionSync.ok) {
          sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
          return;
        }

        const expectedVersion = resolveExpectedPlanningVersion(req, payload);
        const concurrency = evaluatePlanningRouteOptimisticConcurrency({
          pathname,
          method: req.method,
          expectedVersion,
          actualVersion: planningApiState.recordsVersion,
        });

        if (!concurrency.ok) {
          sendJson(res, concurrency.statusCode, concurrency.body);
          return;
        }

        const operation = createPlanningRecordOperation(planningApiState, {
          context,
          request: {
            ...recordInput,
            idempotencyKey,
          },
          nowMs: Date.now(),
        });

        if (operation.ok && operation.body && operation.body.record) {
          const persistedWrite = await persistPlanningRecordToAuthority({
            pathname,
            method: req.method,
            planningPersistenceConfig,
            planningPersistenceState,
            context,
            record: operation.body.record,
          });

          if (!persistedWrite.ok) {
            evictPlanningIdempotencyEntry(planningApiState, {
              operation: 'create',
              scopeKey: operation.body
                && operation.body.idempotency
                && typeof operation.body.idempotency.scopeKey === 'string'
                ? operation.body.idempotency.scopeKey
                : '',
              idempotencyKey,
            });

            await hydratePlanningProjectionFromPersistence({
              pathname,
              method: req.method,
              planningPersistenceConfig,
              planningPersistenceState,
              planningApiState,
              context,
            });
            sendJson(res, persistedWrite.failure.statusCode, persistedWrite.failure.body);
            return;
          }

          operation.body.record = persistedWrite.record;
        }

        sendJson(res, operation.statusCode, operation.body);
      } finally {
        releasePlanningRouteLock(planningApiState, routeLock.lock);
      }
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handlePlanningRecordsList(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    buildPlanningRequestContext,
    parsePlanningScopesFromRequest,
    hydratePlanningProjectionFromPersistence,
    listPlanningRecordsOperation,
  } = deps;

  const context = buildPlanningRequestContext(req, u, null, planningAuthContext);
  const scopes = parsePlanningScopesFromRequest(u);
  hydratePlanningProjectionFromPersistence({
    pathname,
    method: req.method,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    context,
    scopes: scopes.length ? scopes : undefined,
  })
    .then((projectionSync) => {
      if (!projectionSync.ok) {
        sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
        return;
      }

      const operation = listPlanningRecordsOperation(planningApiState, {
        context,
        scopes: scopes.length ? scopes : undefined,
      });
      sendJson(res, operation.statusCode, operation.body);
    })
    .catch((e) => sendJson(res, e.statusCode || 503, { error: String(e.message || e) }));
}

function normalizeIdeaTargetRepoIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function handlePlanningRecordUpdate(ctx, deps) {
  const {
    req,
    res,
    u,
    match,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    readJsonBody,
    buildPlanningRequestContext,
    acquirePlanningMutationRouteLock,
    hydratePlanningProjectionFromPersistence,
    resolveExpectedPlanningVersion,
    evaluatePlanningRouteOptimisticConcurrency,
    persistPlanningRecordToAuthority,
    releasePlanningRouteLock,
  } = deps;

  const recordId = decodeURIComponent((match && match[1]) || '').trim();
  if (!recordId) {
    sendJson(res, 400, { error: 'Invalid record id' });
    return;
  }

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);
      const routeLock = acquirePlanningMutationRouteLock({
        planningApiState,
        pathname,
        method: req.method,
        context,
        idempotencyKey: payload.idempotencyKey,
        requestId: req.headers['x-request-id'],
        nowMs: Date.now(),
      });

      if (!routeLock.ok) {
        sendJson(res, routeLock.statusCode, routeLock.body);
        return;
      }

      try {
        const projectionSync = await hydratePlanningProjectionFromPersistence({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
          planningApiState,
          context,
        });

        if (!projectionSync.ok) {
          sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
          return;
        }

        const expectedVersion = resolveExpectedPlanningVersion(req, payload);
        const concurrency = evaluatePlanningRouteOptimisticConcurrency({
          pathname,
          method: req.method,
          expectedVersion,
          actualVersion: planningApiState.recordsVersion,
        });

        if (!concurrency.ok) {
          sendJson(res, concurrency.statusCode, concurrency.body);
          return;
        }

        const existing = planningApiState.recordsById.get(recordId);
        if (!existing) {
          sendJson(res, 404, { error: 'Planning record not found', recordId });
          return;
        }

        if (String(existing.ownerId || '').trim() !== String(context.userId || '').trim()) {
          sendJson(res, 403, { error: 'Planning record is outside the current user scope', recordId });
          return;
        }

        if (existing.scope === 'repo' && String(existing.repoId || '').trim() !== String(context.repoId || '').trim()) {
          sendJson(res, 403, { error: 'Planning record is outside the current repo scope', recordId });
          return;
        }

        const nextRecord = {
          ...existing,
          title: typeof payload.title === 'string' ? payload.title.trim() : existing.title,
          summary: typeof payload.summary === 'string' ? payload.summary.trim() : existing.summary,
          acceptanceCriteria: Array.isArray(payload.acceptanceCriteria)
            ? payload.acceptanceCriteria.map((entry) => String(entry || '').trim()).filter(Boolean)
            : existing.acceptanceCriteria,
          acceptanceCriteriaText: typeof payload.acceptanceCriteriaText === 'string'
            ? payload.acceptanceCriteriaText.trim()
            : existing.acceptanceCriteriaText,
          targetRepoIds: Array.isArray(payload.targetRepoIds)
            ? normalizeIdeaTargetRepoIds(payload.targetRepoIds)
            : existing.targetRepoIds,
          state: typeof payload.state === 'string' && payload.state.trim() ? payload.state.trim() : existing.state,
          score: Object.prototype.hasOwnProperty.call(payload, 'score') ? payload.score : existing.score,
          updatedAt: new Date().toISOString(),
        };

        const persistedWrite = await persistPlanningRecordToAuthority({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
          context,
          record: nextRecord,
        });

        if (!persistedWrite.ok) {
          sendJson(res, persistedWrite.failure.statusCode, persistedWrite.failure.body);
          return;
        }

        planningApiState.recordsById.set(recordId, persistedWrite.record);
        planningApiState.recordsVersion += 1;

        sendJson(res, 200, {
          contractVersion: deps.PLANNING_API_CONTRACT_VERSION,
          kind: 'planning.update',
          deterministic: true,
          versionVector: {
            planningRecordsVersion: planningApiState.recordsVersion,
          },
          record: persistedWrite.record,
        });
      } finally {
        releasePlanningRouteLock(planningApiState, routeLock.lock);
      }
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e), recordId }));
}

function handlePlanningRecordsSearch(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    buildPlanningRequestContext,
    parsePlanningScopesFromRequest,
    firstStringValue,
    hydratePlanningProjectionFromPersistence,
    searchPlanningRecordsOperation,
    parseNumberQuery,
  } = deps;

  const context = buildPlanningRequestContext(req, u, null, planningAuthContext);
  const scopes = parsePlanningScopesFromRequest(u);
  const query = firstStringValue(u.searchParams.get('q'));
  hydratePlanningProjectionFromPersistence({
    pathname,
    method: req.method,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    context,
    scopes: scopes.length ? scopes : undefined,
  })
    .then((projectionSync) => {
      if (!projectionSync.ok) {
        sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
        return;
      }

      const operation = searchPlanningRecordsOperation(planningApiState, {
        context,
        scopes: scopes.length ? scopes : undefined,
        query,
        limit: parseNumberQuery(u.searchParams, 'limit', 20),
      });
      sendJson(res, operation.statusCode, operation.body);
    })
    .catch((e) => sendJson(res, e.statusCode || 503, { error: String(e.message || e) }));
}

function handlePlanningCompare(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    planningAuthContext,
    copilotHomeAbs,
  } = ctx;
  const {
    sendJson,
    readJsonBody,
    buildPlanningRequestContext,
    hydratePlanningProjectionFromPersistence,
    comparePlanningRecordsOperation,
    resolveRequestIdempotencyKey,
    recordPlanningCompareReceipt,
    resolvePlanningDurabilityWriteAuthority,
    persistPlanningCompareReceipt,
    buildPlanningDurabilityPersistenceFailure,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);
      const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];

      const projectionSync = await hydratePlanningProjectionFromPersistence({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
        planningApiState,
        context,
        scopes,
      });

      if (!projectionSync.ok) {
        sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
        return;
      }

      const operation = comparePlanningRecordsOperation(planningApiState, {
        context,
        request: {
          ...payload,
          scopes,
          query: typeof payload.query === 'string' ? payload.query : '',
          implementedOutcomeSources: Array.isArray(payload.implementedOutcomeSources)
            ? payload.implementedOutcomeSources
            : [],
          idempotencyKey: resolveRequestIdempotencyKey(req, payload),
        },
        implementedOutcomesRootAbs: copilotHomeAbs,
        nowMs: Date.now(),
      });

      if (operation && operation.statusCode === 200 && operation.body && !operation.body.error) {
        const nowMs = Date.now();
        const compareReceipt = recordPlanningCompareReceipt(planningApiState, context, operation.body, nowMs);

        const durabilityAuthority = await resolvePlanningDurabilityWriteAuthority({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
        });

        if (!durabilityAuthority.ok) {
          sendJson(res, durabilityAuthority.failure.statusCode, durabilityAuthority.failure.body);
          return;
        }

        const persistedCompareReceipt = await persistPlanningCompareReceipt(
          durabilityAuthority.authority.client,
          { receipt: compareReceipt },
        );

        if (!persistedCompareReceipt.ok) {
          const failure = buildPlanningDurabilityPersistenceFailure({
            pathname,
            method: req.method,
            planningPersistenceConfig,
            planningPersistenceState,
            authority: durabilityAuthority.authority,
            code: persistedCompareReceipt.error && persistedCompareReceipt.error.code,
            reason: persistedCompareReceipt.error && persistedCompareReceipt.error.reason,
            error: 'Planning compare receipt persistence failed',
            statusCode: 503,
          });
          sendJson(res, failure.statusCode, failure.body);
          return;
        }

        const durableCompareReceipt = persistedCompareReceipt.receipt || compareReceipt;
        operation.body.compareReceipt = durableCompareReceipt;
        operation.body.gateState = durableCompareReceipt.gateState;
        operation.body.mergeEligible = durableCompareReceipt.mergeEligible;
        operation.body.reason = durableCompareReceipt.reason;
        operation.body.downgrade = durableCompareReceipt.downgrade;
      }

      sendJson(res, operation.statusCode, operation.body);
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handlePlanningMergeIntent(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    readJsonBody,
    buildPlanningRequestContext,
    resolvePlanningDurabilityWriteAuthority,
    hydratePlanningMergeDurabilityStateFromAuthority,
    issuePlanningMergeIntent,
    persistPlanningMergeIntent,
    buildPlanningDurabilityPersistenceFailure,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);

      const durabilityAuthority = await resolvePlanningDurabilityWriteAuthority({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
      });

      if (!durabilityAuthority.ok) {
        sendJson(res, durabilityAuthority.failure.statusCode, durabilityAuthority.failure.body);
        return;
      }

      const durabilityHydration = await hydratePlanningMergeDurabilityStateFromAuthority({
        kind: 'planning.merge-intent',
        pathname,
        method: req.method,
        planningApiState,
        planningPersistenceConfig,
        planningPersistenceState,
        authority: durabilityAuthority.authority,
        payload,
        nowMs: Date.now(),
      });

      if (!durabilityHydration.ok) {
        if (durabilityHydration.failure) {
          sendJson(res, durabilityHydration.failure.statusCode, durabilityHydration.failure.body);
          return;
        }

        sendJson(res, durabilityHydration.statusCode || 409, durabilityHydration.body || {
          contractVersion: PLANNING_API_CONTRACT_VERSION,
          kind: 'planning.merge-intent',
          deterministic: true,
          error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_not_found' },
        });
        return;
      }

      const operation = issuePlanningMergeIntent(planningApiState, {
        context,
        payload,
        nowMs: Date.now(),
      });

      if (operation && operation.statusCode === 200 && operation.body && operation.body.intentToken) {
        const persistedIntent = await persistPlanningMergeIntent(
          durabilityAuthority.authority.client,
          { token: operation.body.intentToken },
        );

        if (!persistedIntent.ok) {
          const failure = buildPlanningDurabilityPersistenceFailure({
            pathname,
            method: req.method,
            planningPersistenceConfig,
            planningPersistenceState,
            authority: durabilityAuthority.authority,
            code: persistedIntent.error && persistedIntent.error.code,
            reason: persistedIntent.error && persistedIntent.error.reason,
            error: 'Planning merge intent persistence failed',
            statusCode: 503,
          });
          sendJson(res, failure.statusCode, failure.body);
          return;
        }

        operation.body.intentToken = persistedIntent.token || operation.body.intentToken;
      }

      sendJson(res, operation.statusCode, operation.body);
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handlePlanningMerge(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    readJsonBody,
    buildPlanningRequestContext,
    acquirePlanningMutationRouteLock,
    hydratePlanningProjectionFromPersistence,
    resolveExpectedPlanningVersion,
    evaluatePlanningRouteOptimisticConcurrency,
    resolvePlanningDurabilityWriteAuthority,
    hydratePlanningMergeDurabilityStateFromAuthority,
    executePlanningMerge,
    persistPlanningRecordToAuthority,
    rollbackMergeCommitAfterPersistenceFailure,
    persistPlanningMergeCommitDurabilityArtifacts,
    compensatePlanningMergeDurabilityFailure,
    releasePlanningRouteLock,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);
      const routeLock = acquirePlanningMutationRouteLock({
        planningApiState,
        pathname,
        method: req.method,
        context,
        idempotencyKey: payload.idempotencyKey,
        requestId: req.headers['x-request-id'],
        nowMs: Date.now(),
      });

      if (!routeLock.ok) {
        sendJson(res, routeLock.statusCode, routeLock.body);
        return;
      }

      try {
        const projectionSync = await hydratePlanningProjectionFromPersistence({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
          planningApiState,
          context,
        });

        if (!projectionSync.ok) {
          sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
          return;
        }

        const expectedVersion = resolveExpectedPlanningVersion(req, payload);
        const concurrency = evaluatePlanningRouteOptimisticConcurrency({
          pathname,
          method: req.method,
          expectedVersion,
          actualVersion: planningApiState.recordsVersion,
        });

        if (!concurrency.ok) {
          sendJson(res, concurrency.statusCode, concurrency.body);
          return;
        }

        const durabilityAuthority = await resolvePlanningDurabilityWriteAuthority({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
        });

        if (!durabilityAuthority.ok) {
          sendJson(res, durabilityAuthority.failure.statusCode, durabilityAuthority.failure.body);
          return;
        }

        const mergeNowMs = Date.now();
        const durabilityHydration = await hydratePlanningMergeDurabilityStateFromAuthority({
          kind: 'planning.merge',
          pathname,
          method: req.method,
          planningApiState,
          planningPersistenceConfig,
          planningPersistenceState,
          authority: durabilityAuthority.authority,
          payload,
          nowMs: mergeNowMs,
        });

        if (!durabilityHydration.ok) {
          if (durabilityHydration.failure) {
            sendJson(res, durabilityHydration.failure.statusCode, durabilityHydration.failure.body);
            return;
          }

          sendJson(res, durabilityHydration.statusCode || 409, durabilityHydration.body || {
            contractVersion: PLANNING_API_CONTRACT_VERSION,
            kind: 'planning.merge',
            deterministic: true,
            error: { code: 'invalid_confirmation_token', reason: 'token_not_found' },
          });
          return;
        }

        const operation = executePlanningMerge(planningApiState, {
          context,
          payload,
          nowMs: mergeNowMs,
        });

        const mergeRecord = operation
          && operation.statusCode === 200
          && operation.body
          && operation.body.mergeRecord
          && !(operation.body.idempotency && operation.body.idempotency.replay)
          ? operation.body.mergeRecord
          : null;

        if (mergeRecord) {
          const persistedWrite = await persistPlanningRecordToAuthority({
            pathname,
            method: req.method,
            planningPersistenceConfig,
            planningPersistenceState,
            context,
            record: mergeRecord,
          });

          if (!persistedWrite.ok) {
            rollbackMergeCommitAfterPersistenceFailure(planningApiState, operation.body);
            await hydratePlanningProjectionFromPersistence({
              pathname,
              method: req.method,
              planningPersistenceConfig,
              planningPersistenceState,
              planningApiState,
              context,
            });
            sendJson(res, persistedWrite.failure.statusCode, persistedWrite.failure.body);
            return;
          }

          operation.body.mergeRecord = persistedWrite.record;

          const durabilityCommit = await persistPlanningMergeCommitDurabilityArtifacts({
            pathname,
            method: req.method,
            planningPersistenceConfig,
            planningPersistenceState,
            authority: durabilityAuthority.authority,
            context,
            operationBody: operation.body,
            mergeRecord: persistedWrite.record,
            nowMs: mergeNowMs,
          });

          if (!durabilityCommit.ok) {
            rollbackMergeCommitAfterPersistenceFailure(planningApiState, operation.body);
            await compensatePlanningMergeDurabilityFailure({
              authority: durabilityAuthority.authority,
              context,
              operationBody: operation.body,
              mergeRecord: persistedWrite.record,
            });
            await hydratePlanningProjectionFromPersistence({
              pathname,
              method: req.method,
              planningPersistenceConfig,
              planningPersistenceState,
              planningApiState,
              context,
            });
            sendJson(res, durabilityCommit.failure.statusCode, durabilityCommit.failure.body);
            return;
          }
        }

        sendJson(res, operation.statusCode, operation.body);
      } finally {
        releasePlanningRouteLock(planningApiState, routeLock.lock);
      }
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handlePlanningSuggestionsPersist(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    readJsonBody,
    buildPlanningRequestContext,
    resolvePlanningDurabilityWriteAuthority,
    firstStringValue,
    persistPlanningSuggestion,
    resolvePlanningDurabilityArtifactErrorStatusCode,
    buildPlanningDurabilityArtifactFailureEnvelope,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);

      const durabilityAuthority = await resolvePlanningDurabilityWriteAuthority({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
      });

      if (!durabilityAuthority.ok) {
        sendJson(res, durabilityAuthority.failure.statusCode, durabilityAuthority.failure.body);
        return;
      }

      const scope = firstStringValue(payload.scope) || (context.repoId ? 'repo' : 'user');
      const persisted = await persistPlanningSuggestion(durabilityAuthority.authority.client, {
        actorId: context.userId,
        suggestion: {
          suggestionId: firstStringValue(payload.suggestionId),
          actorId: context.userId,
          repoId: context.repoId,
          scope,
          state: payload.state,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
        },
      });

      if (!persisted.ok) {
        const statusCode = resolvePlanningDurabilityArtifactErrorStatusCode(persisted.error, {
          missingReason: 'missing_suggestion_id',
          invalidCode: 'invalid_planning_suggestion',
        });
        const failure = buildPlanningDurabilityArtifactFailureEnvelope(pathname, req.method, {
          statusCode,
          error: persisted.error,
        });
        sendJson(res, failure.statusCode, failure.body);
        return;
      }

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.suggestion.persist',
        deterministic: true,
        suggestion: persisted.suggestion,
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handlePlanningSuggestionsRead(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    buildPlanningRequestContext,
    firstStringValue,
    resolvePlanningPersistenceOperationClient,
    readPlanningSuggestion,
    resolvePlanningDurabilityArtifactErrorStatusCode,
    buildPlanningDurabilityArtifactFailureEnvelope,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  const context = buildPlanningRequestContext(req, u, null, planningAuthContext);
  const suggestionId = firstStringValue(u.searchParams.get('suggestionId'));

  const operationAuthority = resolvePlanningPersistenceOperationClient({
    pathname,
    method: req.method,
    planningPersistenceConfig,
    planningPersistenceState,
  });

  if (!operationAuthority.ok) {
    sendJson(res, operationAuthority.failure.statusCode, operationAuthority.failure.body);
    return;
  }

  readPlanningSuggestion(operationAuthority.authority.client, {
    actorId: context.userId,
    suggestionId,
  })
    .then((result) => {
      if (!result.ok) {
        const statusCode = resolvePlanningDurabilityArtifactErrorStatusCode(result.error, {
          missingReason: 'missing_suggestion_id',
          invalidCode: 'invalid_planning_suggestion',
        });
        const failure = buildPlanningDurabilityArtifactFailureEnvelope(pathname, req.method, {
          statusCode,
          error: result.error,
        });
        sendJson(res, failure.statusCode, failure.body);
        return;
      }

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.suggestion.read',
        deterministic: true,
        suggestion: result.suggestion,
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 503, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.suggestion.read',
      deterministic: true,
      error: {
        code: 'planning_persistence_read_failed',
        reason: 'planning_persistence_read_failed',
      },
      detail: String(e && e.message ? e.message : e),
    }));
}

function handlePlanningRecapsPersist(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    readJsonBody,
    buildPlanningRequestContext,
    resolvePlanningDurabilityWriteAuthority,
    firstStringValue,
    persistPlanningRecap,
    resolvePlanningDurabilityArtifactErrorStatusCode,
    buildPlanningDurabilityArtifactFailureEnvelope,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);

      const durabilityAuthority = await resolvePlanningDurabilityWriteAuthority({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
      });

      if (!durabilityAuthority.ok) {
        sendJson(res, durabilityAuthority.failure.statusCode, durabilityAuthority.failure.body);
        return;
      }

      const scope = firstStringValue(payload.scope) || (context.repoId ? 'repo' : 'user');
      const persisted = await persistPlanningRecap(durabilityAuthority.authority.client, {
        actorId: context.userId,
        recap: {
          recapId: firstStringValue(payload.recapId),
          actorId: context.userId,
          repoId: context.repoId,
          scope,
          state: payload.state,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
        },
      });

      if (!persisted.ok) {
        const statusCode = resolvePlanningDurabilityArtifactErrorStatusCode(persisted.error, {
          missingReason: 'missing_recap_id',
          invalidCode: 'invalid_planning_recap',
        });
        const failure = buildPlanningDurabilityArtifactFailureEnvelope(pathname, req.method, {
          statusCode,
          error: persisted.error,
        });
        sendJson(res, failure.statusCode, failure.body);
        return;
      }

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.recap.persist',
        deterministic: true,
        recap: persisted.recap,
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handlePlanningRecapsRead(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    buildPlanningRequestContext,
    firstStringValue,
    resolvePlanningPersistenceOperationClient,
    readPlanningRecap,
    resolvePlanningDurabilityArtifactErrorStatusCode,
    buildPlanningDurabilityArtifactFailureEnvelope,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  const context = buildPlanningRequestContext(req, u, null, planningAuthContext);
  const recapId = firstStringValue(u.searchParams.get('recapId'));

  const operationAuthority = resolvePlanningPersistenceOperationClient({
    pathname,
    method: req.method,
    planningPersistenceConfig,
    planningPersistenceState,
  });

  if (!operationAuthority.ok) {
    sendJson(res, operationAuthority.failure.statusCode, operationAuthority.failure.body);
    return;
  }

  readPlanningRecap(operationAuthority.authority.client, {
    actorId: context.userId,
    recapId,
  })
    .then((result) => {
      if (!result.ok) {
        const statusCode = resolvePlanningDurabilityArtifactErrorStatusCode(result.error, {
          missingReason: 'missing_recap_id',
          invalidCode: 'invalid_planning_recap',
        });
        const failure = buildPlanningDurabilityArtifactFailureEnvelope(pathname, req.method, {
          statusCode,
          error: result.error,
        });
        sendJson(res, failure.statusCode, failure.body);
        return;
      }

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.recap.read',
        deterministic: true,
        recap: result.recap,
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 503, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.recap.read',
      deterministic: true,
      error: {
        code: 'planning_persistence_read_failed',
        reason: 'planning_persistence_read_failed',
      },
      detail: String(e && e.message ? e.message : e),
    }));
}

function handlePlanningWorkflowArtifactsPersist(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    readJsonBody,
    buildPlanningRequestContext,
    resolvePlanningDurabilityWriteAuthority,
    firstStringValue,
    persistRoadmapWorkflowArtifact,
    roadmapWorkflowPlanningBridge,
    roadmapWorkflowMemoryBridge,
    resolvePlanningDurabilityArtifactErrorStatusCode,
    buildPlanningDurabilityArtifactFailureEnvelope,
    buildPlanningDurabilityPersistenceFailure,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  readJsonBody(req)
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);

      const durabilityAuthority = await resolvePlanningDurabilityWriteAuthority({
        pathname,
        method: req.method,
        planningPersistenceConfig,
        planningPersistenceState,
      });

      if (!durabilityAuthority.ok) {
        sendJson(res, durabilityAuthority.failure.statusCode, durabilityAuthority.failure.body);
        return;
      }

      const artifact = payload.artifact && typeof payload.artifact === 'object' ? payload.artifact : payload;
      const markdownBody = typeof artifact.body === 'string'
        ? artifact.body
        : (typeof payload.markdown === 'string' ? payload.markdown : '');
      const parsedArtifact = markdownBody.trim()
        ? parseRoadmapWorkflowMarkdownArtifact(markdownBody)
        : null;
      const structuredState = artifact.structuredState && typeof artifact.structuredState === 'object'
        ? artifact.structuredState
        : (parsedArtifact ? parsedArtifact.artifact : null);
      const derivedRoadmapId = parsedArtifact ? parsedArtifact.artifact.roadmapId : null;
      const derivedSliceId = parsedArtifact && parsedArtifact.artifact.sliceId ? parsedArtifact.artifact.sliceId : null;
      const derivedKind = parsedArtifact ? parsedArtifact.artifact.kind : null;
      const derivedPhase = parsedArtifact ? parsedArtifact.artifact.phase : null;
      const derivedStatus = parsedArtifact ? parsedArtifact.artifact.status : null;
      const derivedHarness = parsedArtifact && parsedArtifact.artifact.sourceHarness ? parsedArtifact.artifact.sourceHarness : null;
      const derivedModel = parsedArtifact && parsedArtifact.artifact.sourceModel ? parsedArtifact.artifact.sourceModel : null;
      const derivedSessionId = parsedArtifact && parsedArtifact.artifact.sessionId ? parsedArtifact.artifact.sessionId : null;
      const checksum = firstStringValue(artifact.checksum)
        || (markdownBody.trim() ? computeRoadmapWorkflowArtifactChecksum(markdownBody) : '');
      const artifactId = firstStringValue(artifact.artifactId)
        || [
          context.userId,
          context.repoId || firstStringValue(artifact.repoId) || 'global',
          firstStringValue(artifact.roadmapId) || derivedRoadmapId || 'roadmap',
          firstStringValue(artifact.sliceId) || derivedSliceId || 'root',
          firstStringValue(artifact.kind) || derivedKind || 'artifact',
          checksum.slice(0, 12),
        ].join(':');
      const persisted = await persistRoadmapWorkflowArtifact(durabilityAuthority.authority.client, {
        actorId: context.userId,
        artifact: {
          artifactId,
          actorId: context.userId,
          repoId: context.repoId || firstStringValue(artifact.repoId) || null,
          roadmapId: firstStringValue(artifact.roadmapId) || derivedRoadmapId,
          sliceId: firstStringValue(artifact.sliceId) || derivedSliceId || null,
          kind: firstStringValue(artifact.kind) || derivedKind,
          phase: firstStringValue(artifact.phase) || derivedPhase,
          status: firstStringValue(artifact.status) || derivedStatus,
          checksum,
          sourceHarness: firstStringValue(artifact.sourceHarness) || derivedHarness || null,
          sourceModel: firstStringValue(artifact.sourceModel) || derivedModel || null,
          sessionId: firstStringValue(artifact.sessionId) || derivedSessionId || null,
          body: markdownBody,
          structuredState,
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt,
        },
      });

      if (!persisted.ok) {
        const statusCode = resolvePlanningDurabilityArtifactErrorStatusCode(persisted.error, {
          missingReason: 'missing_artifact_id',
          invalidCode: 'invalid_planning_workflow_artifact',
        });
        const failure = buildPlanningDurabilityArtifactFailureEnvelope(pathname, req.method, {
          statusCode,
          error: persisted.error,
        });
        sendJson(res, failure.statusCode, failure.body);
        return;
      }

      const memorySync = await syncPlanningWorkflowArtifactMemory(
        roadmapWorkflowMemoryBridge,
        persisted.artifact,
      );
      const elegyPlanningSync = await syncPlanningWorkflowArtifactAuthority(
        roadmapWorkflowPlanningBridge,
        persisted.artifact,
        {
          requestId: firstStringValue(req.headers['x-request-id']) || persisted.artifact.artifactId,
        },
      );

      if (!elegyPlanningSync || elegyPlanningSync.status !== 'synced') {
        const syncError = Array.isArray(elegyPlanningSync?.errors) && elegyPlanningSync.errors[0]
          ? elegyPlanningSync.errors[0]
          : null;
        const failure = buildPlanningDurabilityPersistenceFailure({
          pathname,
          method: req.method,
          statusCode: 503,
          code: syncError && typeof syncError.code === 'string' && syncError.code.trim()
            ? syncError.code.trim()
            : 'planning_workflow_authority_sync_failed',
          reason: 'planning_workflow_authority_sync_failed',
          error: 'Planning durability persistence failed',
          planningPersistenceConfig,
          planningPersistenceState,
        });
        sendJson(res, failure.statusCode, {
          ...failure.body,
          detail: syncError && typeof syncError.message === 'string' && syncError.message.trim()
            ? syncError.message.trim()
            : 'Workflow artifact was persisted locally, but elegy-planning authority sync did not complete.',
          ...(memorySync ? { memorySync } : {}),
          ...(elegyPlanningSync ? { elegyPlanningSync } : {}),
        });
        return;
      }

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.workflow-artifact.persist',
        deterministic: true,
        artifact: persisted.artifact,
        ...(memorySync ? { memorySync } : {}),
        ...(elegyPlanningSync ? { elegyPlanningSync } : {}),
      });
    })
    .catch((e) => {
      const errorCode = String(e && e.code ? e.code : '').trim();
      const statusCode = Number.isFinite(e && e.statusCode)
        ? Number(e.statusCode)
        : (
          errorCode === 'invalid_markdown'
          || errorCode === 'missing_structured_state'
          || errorCode === 'invalid_json'
          || errorCode === 'invalid_artifact_shape'
          || errorCode === 'invalid_artifact_kind'
            ? 400
            : 503
        );
      if (statusCode < 500) {
        sendJson(res, statusCode, {
          contractVersion: PLANNING_API_CONTRACT_VERSION,
          kind: 'planning.workflow-artifact.persist',
          deterministic: true,
          error: String(e && e.message ? e.message : e),
        });
        return;
      }

      const failure = buildPlanningDurabilityPersistenceFailure({
        pathname,
        method: req.method,
        statusCode,
        code: 'planning_persistence_write_failed',
        reason: 'planning_persistence_write_failed',
        error: 'Planning durability persistence failed',
        planningPersistenceConfig,
        planningPersistenceState,
      });
      sendJson(res, failure.statusCode, {
        ...failure.body,
        detail: String(e && e.message ? e.message : e),
      });
    });
}

function handlePlanningWorkflowArtifactsRead(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    buildPlanningRequestContext,
    firstStringValue,
    resolvePlanningPersistenceOperationClient,
    readRoadmapWorkflowArtifact,
    resolvePlanningDurabilityArtifactErrorStatusCode,
    buildPlanningDurabilityArtifactFailureEnvelope,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  const context = buildPlanningRequestContext(req, u, null, planningAuthContext);
  const artifactId = firstStringValue(u.searchParams.get('artifactId'));

  const operationAuthority = resolvePlanningPersistenceOperationClient({
    pathname,
    method: req.method,
    planningPersistenceConfig,
    planningPersistenceState,
  });

  if (!operationAuthority.ok) {
    sendJson(res, operationAuthority.failure.statusCode, operationAuthority.failure.body);
    return;
  }

  readRoadmapWorkflowArtifact(operationAuthority.authority.client, {
    actorId: context.userId,
    artifactId,
  })
    .then((result) => {
      if (!result.ok) {
        const statusCode = resolvePlanningDurabilityArtifactErrorStatusCode(result.error, {
          missingReason: 'missing_artifact_id',
          invalidCode: 'invalid_planning_workflow_artifact',
        });
        const failure = buildPlanningDurabilityArtifactFailureEnvelope(pathname, req.method, {
          statusCode,
          error: result.error,
        });
        sendJson(res, failure.statusCode, failure.body);
        return;
      }

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.workflow-artifact.read',
        deterministic: true,
        artifact: result.artifact,
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 503, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.workflow-artifact.read',
      deterministic: true,
      error: {
        code: 'planning_persistence_read_failed',
        reason: 'planning_persistence_read_failed',
      },
      detail: String(e && e.message ? e.message : e),
    }));
}

function handlePlanningWorkflowArtifactContinuationPackage(ctx, deps) {
  const {
    req,
    res,
    u,
    pathname,
    planningPersistenceConfig,
    planningPersistenceState,
    planningAuthContext,
  } = ctx;
  const {
    sendJson,
    buildPlanningRequestContext,
    firstStringValue,
    resolvePlanningPersistenceOperationClient,
    readRoadmapWorkflowArtifact,
    resolvePlanningDurabilityArtifactErrorStatusCode,
    buildPlanningDurabilityArtifactFailureEnvelope,
    continuationPackages,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  const context = buildPlanningRequestContext(req, u, null, planningAuthContext);
  const artifactId = firstStringValue(u.searchParams.get('artifactId'));
  const targetHarness = continuationPackages.normalizeTargetHarness(u.searchParams.get('targetHarness') || 'opencode');

  const operationAuthority = resolvePlanningPersistenceOperationClient({
    pathname,
    method: req.method,
    planningPersistenceConfig,
    planningPersistenceState,
  });

  if (!operationAuthority.ok) {
    sendJson(res, operationAuthority.failure.statusCode, operationAuthority.failure.body);
    return;
  }

  readRoadmapWorkflowArtifact(operationAuthority.authority.client, {
    actorId: context.userId,
    artifactId,
  })
    .then((result) => {
      if (!result.ok) {
        const statusCode = resolvePlanningDurabilityArtifactErrorStatusCode(result.error, {
          missingReason: 'missing_artifact_id',
          invalidCode: 'invalid_planning_workflow_artifact',
        });
        const failure = buildPlanningDurabilityArtifactFailureEnvelope(pathname, req.method, {
          statusCode,
          error: result.error,
        });
        sendJson(res, failure.statusCode, failure.body);
        return;
      }

      const artifact = result.artifact;
      const structuredState = artifact && artifact.structuredState && typeof artifact.structuredState === 'object'
        ? artifact.structuredState
        : {};
      const packageBody = continuationPackages.buildSessionContinuationPackage({
        kind: 'planning.workflow-artifact.continuation-package',
        targetHarness,
        source: {
          kind: 'planning.workflow-artifact',
          artifactId: artifact.artifactId,
          sessionId: artifact.sessionId || null,
          harness: artifact.sourceHarness || 'copilot',
          model: artifact.sourceModel || null,
          sessionSource: null,
        },
        repo: {
          repoId: artifact.repoId || null,
          repoPath: null,
          repoLabel: artifact.repoId || null,
          branch: null,
        },
        roadmap: {
          roadmapId: artifact.roadmapId || null,
          roadmapIds: artifact.roadmapId ? [artifact.roadmapId] : [],
          sliceId: artifact.sliceId || null,
          planRef: null,
          linkedBacklogIds: [],
        },
        objective: artifact.roadmapId || artifact.kind || null,
        summary: normalizeOptionalString(artifact.body) || normalizeOptionalString(structuredState.suggestedNextAction) || null,
        constraints: uniqueStrings([
          ...(structuredState.requiresUserDecision ? ['User decision required before execution can continue.'] : []),
          ...(Array.isArray(structuredState.acceptance && structuredState.acceptance.failedChecks)
            ? structuredState.acceptance.failedChecks
            : []),
        ]),
        openQuestions: uniqueStrings([
          ...(Array.isArray(structuredState.followUps) ? structuredState.followUps : []),
          ...(structuredState.requiresUserDecision ? ['Confirm the next decision before continuing implementation.'] : []),
        ]),
        nextActions: uniqueStrings([
          structuredState.suggestedNextAction,
          structuredState.roadmapImpact,
        ]),
        carryover: uniqueStrings(Array.isArray(structuredState.followUps) ? structuredState.followUps : []),
        skillsRequired: uniqueStrings([
          'implementation-handoff',
          'roadmap-planning',
          ...(artifact.phase === 'implementation' || artifact.phase === 'review' ? ['implementation-review'] : []),
        ]),
        sourceArtifacts: uniqueStrings(['planning.workflow-artifact']),
        transcriptExcerpt: [],
      });

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.workflow-artifact.continuation-package',
        deterministic: true,
        continuationPackage: packageBody,
        continuationContractVersion: CONTINUATION_PACKAGE_CONTRACT_VERSION,
      });
    })
    .catch((e) => sendJson(res, e.statusCode || 503, {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.workflow-artifact.continuation-package',
      deterministic: true,
      error: {
        code: 'planning_persistence_read_failed',
        reason: 'planning_persistence_read_failed',
      },
      detail: String(e && e.message ? e.message : e),
    }));
}

function handlePlanningSessionRead(ctx, deps) {
  const { req, res, u } = ctx;
  const {
    sendJson,
    PLANNING_API_CONTRACT_VERSION,
    roadmapWorkflowPlanningBridge,
  } = deps;

  Promise.resolve()
    .then(() => {
      const planningSession = require('../lib/planningSession');
      const env = process.env;
      const dbPath = env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH
        || path.join(require('os').homedir(), '.copilot', 'elegy-planning.db');
      const homedir = require('os').homedir && require('os').homedir() || require('os').tmpdir();

      const resolved = planningSession.readPlanningSession(env, { homedir, dbPath });
      const resolvedPath = planningSession.resolveSessionSidecarPath(env, homedir, dbPath);

      const ready = resolved.exists
        || (() => {
            try {
              const parentDir = path.dirname(resolvedPath);
              return fs.existsSync(parentDir) && fs.accessSync(parentDir, fs.constants.W_OK) === undefined;
            } catch {
              return false;
            }
          })();

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.session',
        deterministic: true,
        ready,
        sidecarPath: resolvedPath,
        exists: resolved.exists,
        sidecar: resolved.sidecar,
        lastChecked: new Date().toISOString(),
        correlationId: 'planning-session-check',
        availableAt: resolved.candidatePaths,
      });
    })
    .catch((error) => {
      sendJson(res, 503, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.session',
        deterministic: true,
        ready: false,
        sidecarPath: null,
        exists: false,
        sidecar: null,
        lastChecked: new Date().toISOString(),
        correlationId: 'planning-session-check',
        availableAt: [],
        error: String(error && error.message ? error.message : error),
      });
    });
}

async function handlePlanningExplorerSearch(ctx, deps) {
  const { req, res, u } = ctx;
  const {
    sendJson,
    roadmapWorkflowPlanningBridge,
    PLANNING_API_CONTRACT_VERSION,
  } = deps;

  Promise.resolve()
    .then(async () => {
      const bridge = requirePlanningLiveAuthorityBridge(roadmapWorkflowPlanningBridge);

      const entityTypeFilter = normalizeOptionalString(u.searchParams.get('entityType'));
      const repoId = normalizeOptionalString(u.searchParams.get('repoId'));
      const repoLabel = normalizeOptionalString(u.searchParams.get('repoLabel'));
      const statusFilter = normalizeOptionalString(u.searchParams.get('status'));
      const tagFilter = normalizeOptionalString(u.searchParams.get('tag'));
      const sourceFilter = normalizeOptionalString(u.searchParams.get('source'));
      const parentGoalId = normalizeOptionalString(u.searchParams.get('parentGoalId'));
      const q = normalizeOptionalString(u.searchParams.get('q'));
      const includeUnscoped = String(u.searchParams.get('includeUnscoped') || '').toLowerCase() === 'true';
      const limit = parseInt(u.searchParams.get('limit') || '100', 10);

      const repo = buildPlanningRepoSelection(repoId, undefined, repoLabel);

      const results = [];
      const filterWarnings = [];

      const collectEntity = (entityType, collection) => {
        if (!Array.isArray(collection)) return;
        for (const entity of collection) {
          if (entityTypeFilter && entityTypeFilter !== entityType) continue;
          const tags = getPlanningEntityTags(entity);
          const tagsLower = tags.map((t) => t.toLowerCase());

          if (statusFilter) {
            const entityStatus = normalizeOptionalString(entity.status);
            if (entityStatus !== statusFilter) continue;
          }
          if (tagFilter && !tagsLower.includes(tagFilter.toLowerCase())) continue;
          if (sourceFilter) {
            const hasSource = tagsLower.some((t) => t === `source:${sourceFilter}`.toLowerCase());
            if (!hasSource) continue;
          }
          if (parentGoalId && entity.goalId !== parentGoalId) continue;
          if (q) {
            const searchText = [
              entity.title, entity.summary, entity.description,
              'id:' + entity.id,
            ].filter(Boolean).join(' ').toLowerCase();
            if (!searchText.includes(q.toLowerCase())) continue;
          }

          const hasRepoTags = tagsLower.some((t) => t.startsWith('repo:'));
          if (!hasRepoTags) {
            filterWarnings.push({
              entityType,
              entityId: entity.id,
              bucket: 'unscoped',
              reason: 'Entity has no repo:* tags',
            });
            if (!includeUnscoped) continue;
          }

          const entry = {
            entityType,
            entityId: entity.id,
            title: entity.title || entity.id,
            summary: entity.summary || null,
            status: entity.status || null,
            tags: tags,
            repoScope: {
              direct: tags.filter((t) => t.startsWith('repo:')),
              inherited: [],
            },
            parentChain: {
              goalId: entity.goalId || null,
              roadmapId: entity.roadmapId || null,
              planId: entity.planId || null,
            },
            createdAt: entity.createdAt || entity.created_at || null,
            updatedAt: entity.updatedAt || entity.updated_at || null,
            raw: entity,
          };

          results.push(entry);
        }
      };

      // Fetch all entity types from the bridge
      try {
        if (bridge.listGoals) {
          const goalsResp = await bridge.listGoals({ requestId: 'planning-explorer-goals' });
          collectEntity('goal', goalsResp && goalsResp.goals);
        }
      } catch {}

      try {
        if (bridge.listRoadmaps) {
          const roadmapsResp = await bridge.listRoadmaps({ requestId: 'planning-explorer-roadmaps' });
          collectEntity('roadmap', roadmapsResp && roadmapsResp.roadmaps);
        }
      } catch {}

      try {
        if (bridge.listPlans) {
          const plansResp = await bridge.listPlans({ requestId: 'planning-explorer-plans' });
          collectEntity('plan', plansResp && plansResp.plans);
        }
      } catch {}

      try {
        if (bridge.listTodos) {
          const todosResp = await bridge.listTodos({ requestId: 'planning-explorer-todos' });
          collectEntity('todo', todosResp && todosResp.todos);
        }
      } catch {}

      // Apply limit
      const sliced = results.slice(0, Math.min(limit, 200));

      const summary = {
        byType: {},
        byRepoScope: { direct: 0, inherited: 0 },
        byBucket: {
          unscoped: filterWarnings.filter((w) => w.bucket === 'unscoped').length,
        },
      };
      for (const r of sliced) {
        summary.byType[r.entityType] = (summary.byType[r.entityType] || 0) + 1;
        if (r.repoScope.direct.length > 0) summary.byRepoScope.direct++;
        if (r.repoScope.inherited.length > 0) summary.byRepoScope.inherited++;
      }

      sendJson(res, 200, {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.explorer',
        deterministic: false,
        entities: sliced,
        total: results.length,
        filterWarnings: filterWarnings.slice(0, 50),
        summary,
      });
    })
    .catch((error) => {
      const failure = buildPlanningLiveReadFailure(
        error,
        PLANNING_API_CONTRACT_VERSION,
        'planning.explorer',
        'Unable to load planning explorer data from elegy-planning.',
      );
      sendJson(res, failure.statusCode, failure.body);
    });
}

function register(deps = {}) {
  const resolvedDeps = {
    ...deps,
    continuationPackages: deps.continuationPackages || continuationPackagesLib,
    PLANNING_API_CONTRACT_VERSION: SHARED_PLANNING_API_CONTRACT_VERSION,
  };

  return [
    {
      method: 'GET',
      path: '/api/planning/task-board',
      handler: (ctx) => handlePlanningTaskBoard(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/live/roadmaps',
      handler: (ctx) => handlePlanningLiveRoadmapsList(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/planning\/live\/roadmaps\/([^/]+)$/,
      handler: (ctx) => handlePlanningLiveRoadmapRead(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/planning\/live\/goals\/([^/]+)$/,
      handler: (ctx) => handlePlanningLiveGoalRead(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/live/plans',
      handler: (ctx) => handlePlanningLivePlansList(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/planning\/live\/plans\/([^/]+)$/,
      handler: (ctx) => handlePlanningLivePlanRead(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/live/todos',
      handler: (ctx) => handlePlanningLiveTodosList(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/persistence/init',
      handler: (ctx) => handlePlanningPersistenceInit(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/persistence/corruption/scan',
      handler: (ctx) => handlePlanningPersistenceCorruptionScan(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/persistence/retention',
      handler: (ctx) => handlePlanningPersistenceRetention(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/persistence/export',
      handler: (ctx) => handlePlanningPersistenceExport(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/persistence/import',
      handler: (ctx) => handlePlanningPersistenceImport(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/records',
      handler: (ctx) => handlePlanningRecordsCreate(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/records',
      handler: (ctx) => handlePlanningRecordsList(ctx, resolvedDeps),
    },
    {
      method: 'PATCH',
      path: /^\/api\/planning\/records\/([^/]+)$/,
      handler: (ctx) => handlePlanningRecordUpdate(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/search',
      handler: (ctx) => handlePlanningRecordsSearch(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/compare',
      handler: (ctx) => handlePlanningCompare(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/merge-intent',
      handler: (ctx) => handlePlanningMergeIntent(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/merge',
      handler: (ctx) => handlePlanningMerge(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/suggestions',
      handler: (ctx) => handlePlanningSuggestionsPersist(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/suggestions',
      handler: (ctx) => handlePlanningSuggestionsRead(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/recaps',
      handler: (ctx) => handlePlanningRecapsPersist(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/recaps',
      handler: (ctx) => handlePlanningRecapsRead(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/workflow-artifacts',
      handler: (ctx) => handlePlanningWorkflowArtifactsPersist(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/workflow-artifacts',
      handler: (ctx) => handlePlanningWorkflowArtifactsRead(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/workflow-artifacts/continuation-package',
      handler: (ctx) => handlePlanningWorkflowArtifactContinuationPackage(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/session',
      handler: (ctx) => handlePlanningSessionRead(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/explorer',
      handler: (ctx) => handlePlanningExplorerSearch(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
