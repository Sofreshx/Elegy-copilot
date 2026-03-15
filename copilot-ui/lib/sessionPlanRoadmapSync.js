'use strict';

const planStateLib = require('./planState');
const repositoryBacklogFileLib = require('./repositoryBacklogFile');
const roadmapArtifactsLib = require('./roadmapArtifacts');

const PLAN_SYNC_MARKER_NAMES = Object.freeze({
  linkedBacklogIds: 'IE_LINKED_BACKLOG_IDS',
  linkedRoadmapIds: 'IE_LINKED_ROADMAP_IDS',
  planRef: 'IE_PLAN_REF',
  sessionRef: 'IE_SESSION_REF',
  outcome: 'IE_PLAN_OUTCOME',
});

const SESSION_PLAN_SYNC_OUTCOMES = Object.freeze([
  'completed',
  'superseded',
  'abandoned',
]);

function deterministicStringCompare(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildError(message, statusCode, code, extra = {}) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    reason: code,
    ...extra,
  });
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMarkerValues(text, markerName) {
  const pattern = new RegExp(
    `^\\s*(?:<!--\\s*)?${escapeRegExp(markerName)}\\s*:\\s*(.*?)\\s*(?:-->)?\\s*$`,
    'gmi',
  );
  const matches = [];
  let match = pattern.exec(String(text || ''));
  while (match) {
    matches.push(match[1]);
    match = pattern.exec(String(text || ''));
  }
  return matches;
}

function normalizeDeterministicStringList(value) {
  const entries = Array.isArray(value) ? value : [value];
  return [...new Set(
    entries
      .flatMap((entry) => String(entry == null ? '' : entry).split(','))
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
  )].sort(deterministicStringCompare);
}

function normalizeSyncOutcome(value, { allowEmpty = false } = {}) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    if (allowEmpty) return null;
    throw buildError('plan outcome is required', 400, 'session_plan_sync_outcome_required');
  }
  if (normalized === 'merged') {
    return 'completed';
  }
  if (SESSION_PLAN_SYNC_OUTCOMES.includes(normalized)) {
    return normalized;
  }
  throw buildError(
    `unsupported plan outcome: ${value}`,
    400,
    'session_plan_sync_invalid_outcome',
  );
}

function normalizeSingleMarkerValue(values, options = {}) {
  const normalized = normalizeDeterministicStringList(values);
  if (!normalized.length) {
    return null;
  }
  if (normalized.length > 1) {
    throw buildError(
      `${options.label || 'marker'} must not contain conflicting values`,
      409,
      options.code || 'session_plan_sync_conflicting_marker',
      { values: normalized },
    );
  }
  return normalized[0];
}

function parsePlanSyncMarkers(planText, options = {}) {
  const roadmapArtifacts = options.roadmapArtifacts || roadmapArtifactsLib;
  const linkedBacklogIds = normalizeDeterministicStringList(
    extractMarkerValues(planText, PLAN_SYNC_MARKER_NAMES.linkedBacklogIds),
  );
  const linkedRoadmapIds = normalizeDeterministicStringList(
    extractMarkerValues(planText, PLAN_SYNC_MARKER_NAMES.linkedRoadmapIds),
  );
  const planRef = normalizeSingleMarkerValue(
    [
      ...extractMarkerValues(planText, PLAN_SYNC_MARKER_NAMES.planRef),
      ...extractMarkerValues(planText, PLAN_SYNC_MARKER_NAMES.sessionRef),
    ],
    {
      label: 'plan reference marker',
      code: 'session_plan_sync_conflicting_plan_ref',
    },
  );
  const outcomeValue = normalizeSingleMarkerValue(
    extractMarkerValues(planText, PLAN_SYNC_MARKER_NAMES.outcome),
    {
      label: 'plan outcome marker',
      code: 'session_plan_sync_conflicting_outcome_marker',
    },
  );

  for (const backlogId of linkedBacklogIds) {
    if (!roadmapArtifacts.BACKLOG_ITEM_ID_RE.test(backlogId)) {
      throw buildError(
        `invalid linked backlog id: ${backlogId}`,
        400,
        'session_plan_sync_invalid_backlog_id',
      );
    }
  }

  for (const roadmapId of linkedRoadmapIds) {
    if (!roadmapArtifacts.ROADMAP_ITEM_ID_RE.test(roadmapId)) {
      throw buildError(
        `invalid linked roadmap id: ${roadmapId}`,
        400,
        'session_plan_sync_invalid_roadmap_id',
      );
    }
  }

  if (planRef && !roadmapArtifacts.PLAN_REF_RE.test(planRef)) {
    throw buildError(
      `invalid plan reference: ${planRef}`,
      400,
      'session_plan_sync_invalid_plan_ref',
    );
  }

  return {
    linkedBacklogIds,
    linkedRoadmapIds,
    planRef,
    outcome: outcomeValue ? normalizeSyncOutcome(outcomeValue) : null,
  };
}

function inferSyncOutcomeFromStructuredState(structuredState, options = {}) {
  const planState = options.planState || planStateLib;
  const terminalStates = new Set(planState.TERMINAL_PLANNING_STATES || []);
  const statuses = [];

  for (const group of Array.isArray(structuredState && structuredState.groups) ? structuredState.groups : []) {
    const normalized = planState.normalizePlanningState(group && group.status);
    if (normalized) {
      statuses.push(normalized);
    }
  }

  for (const workUnit of Array.isArray(structuredState && structuredState.workUnits) ? structuredState.workUnits : []) {
    const normalized = planState.normalizePlanningState(workUnit && workUnit.status);
    if (normalized) {
      statuses.push(normalized);
    }
  }

  if (!statuses.length) {
    return null;
  }

  if (statuses.some((status) => !terminalStates.has(status))) {
    return null;
  }

  const distinct = [...new Set(statuses)].sort(deterministicStringCompare);
  if (distinct.length !== 1) {
    throw buildError(
      'plan tracker contains conflicting terminal outcomes',
      409,
      'session_plan_sync_conflicting_terminal_state',
      { statuses: distinct },
    );
  }

  return distinct[0] === 'merged' ? 'completed' : distinct[0];
}

function buildDefaultPlanRef(sessionId) {
  return `session:${normalizeString(sessionId)}`;
}

function roadmapSlugFromItemId(roadmapId, roadmapArtifacts = roadmapArtifactsLib) {
  const match = normalizeString(roadmapId).match(roadmapArtifacts.ROADMAP_ITEM_ID_RE);
  if (!match) {
    throw buildError(
      `invalid linked roadmap id: ${roadmapId}`,
      400,
      'session_plan_sync_invalid_roadmap_id',
    );
  }
  return match[1];
}

function assertDeterministicCoverage(linkedBacklogIds, linkedRoadmapItems) {
  const expected = normalizeDeterministicStringList(linkedBacklogIds);
  const actual = normalizeDeterministicStringList(
    linkedRoadmapItems.flatMap((item) => item.backlogIds),
  );

  if (
    expected.length !== actual.length
    || expected.some((entry, index) => entry !== actual[index])
  ) {
    throw buildError(
      'linked backlog ids do not match linked roadmap coverage',
      409,
      'session_plan_sync_link_mismatch',
      {
        expectedBacklogIds: expected,
        coveredBacklogIds: actual,
      },
    );
  }
}

function syncSessionPlanToRoadmap(repoRoot, sessionId, planText, options = {}) {
  const repositoryBacklogFile = options.repositoryBacklogFile || repositoryBacklogFileLib;
  const roadmapArtifacts = options.roadmapArtifacts || roadmapArtifactsLib;
  const planState = options.planState || planStateLib;

  const markers = parsePlanSyncMarkers(planText, { roadmapArtifacts });
  if (!markers.linkedBacklogIds.length) {
    throw buildError(
      'linked backlog ids are required for roadmap sync',
      409,
      'session_plan_sync_backlog_ids_missing',
    );
  }
  if (!markers.linkedRoadmapIds.length) {
    throw buildError(
      'linked roadmap ids are required for roadmap sync',
      409,
      'session_plan_sync_roadmap_ids_missing',
    );
  }

  const structuredState = planState.parseStructuredState(planText);
  const outcome = markers.outcome || inferSyncOutcomeFromStructuredState(structuredState, { planState });
  if (!outcome) {
    throw buildError(
      'linked plan pack has not reached a terminal outcome',
      409,
      'session_plan_sync_not_terminal',
    );
  }

  const planRef = markers.planRef || buildDefaultPlanRef(sessionId);
  if (!roadmapArtifacts.PLAN_REF_RE.test(planRef)) {
    throw buildError(
      `invalid plan reference: ${planRef}`,
      400,
      'session_plan_sync_invalid_plan_ref',
    );
  }

  const backlogState = repositoryBacklogFile.readRepositoryBacklogFile(repoRoot);
  if (!backlogState.exists) {
    throw buildError(
      'repository backlog file not found',
      409,
      'session_plan_sync_backlog_file_missing',
    );
  }

  const backlogById = new Map(backlogState.backlog.items.map((item) => [item.id, item]));
  const missingBacklogIds = markers.linkedBacklogIds.filter((id) => !backlogById.has(id));
  if (missingBacklogIds.length) {
    throw buildError(
      'linked backlog items were not found in repository backlog',
      409,
      'session_plan_sync_backlog_not_found',
      { missingBacklogIds },
    );
  }

  const roadmapIdsBySlug = new Map();
  for (const roadmapId of markers.linkedRoadmapIds) {
    const slug = roadmapSlugFromItemId(roadmapId, roadmapArtifacts);
    const list = roadmapIdsBySlug.get(slug) || [];
    list.push(roadmapId);
    roadmapIdsBySlug.set(slug, list);
  }

  const reconciledRoadmaps = [];
  const linkedRoadmapItems = [];
  for (const [slug, roadmapIds] of roadmapIdsBySlug.entries()) {
    let roadmap;
    try {
      roadmap = roadmapArtifacts.readRoadmapDocument(repoRoot, slug);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw buildError(
          `linked roadmap document not found: ${slug}`,
          409,
          'session_plan_sync_roadmap_not_found',
          { slug },
        );
      }
      throw error;
    }

    const missingRoadmapIds = roadmapIds.filter((id) => !roadmap.items.some((item) => item.id === id));
    if (missingRoadmapIds.length) {
      throw buildError(
        'linked roadmap items were not found in the roadmap document',
        409,
        'session_plan_sync_roadmap_item_not_found',
        { slug, missingRoadmapIds },
      );
    }

    for (const roadmapId of roadmapIds) {
      const item = roadmap.items.find((entry) => entry.id === roadmapId);
      if (!item.backlogIds.length) {
        throw buildError(
          `linked roadmap item ${roadmapId} has no linked backlog ids`,
          409,
          'session_plan_sync_roadmap_backlog_missing',
          { roadmapId },
        );
      }
      if (item.backlogIds.some((backlogId) => !markers.linkedBacklogIds.includes(backlogId))) {
        throw buildError(
          `linked roadmap item ${roadmapId} references backlog ids outside the plan markers`,
          409,
          'session_plan_sync_roadmap_backlog_mismatch',
          {
            roadmapId,
            roadmapBacklogIds: item.backlogIds.slice(),
            linkedBacklogIds: markers.linkedBacklogIds.slice(),
          },
        );
      }
      linkedRoadmapItems.push(item);
    }

    for (const roadmapId of roadmapIds) {
      const existingItem = roadmap.items.find((entry) => entry.id === roadmapId);
      const result = roadmapArtifacts.reconcileRoadmapItem(roadmap, {
        itemId: roadmapId,
        backlogIds: existingItem.backlogIds,
        planRef,
        outcome,
      });
      roadmap = result.roadmap;
    }

    reconciledRoadmaps.push(roadmapArtifacts.writeRoadmapDocument(repoRoot, roadmap));
  }

  assertDeterministicCoverage(markers.linkedBacklogIds, linkedRoadmapItems);

  const roadmapIdsByBacklogId = new Map();
  for (const item of linkedRoadmapItems) {
    for (const backlogId of item.backlogIds) {
      const list = roadmapIdsByBacklogId.get(backlogId) || [];
      list.push(item.id);
      roadmapIdsByBacklogId.set(backlogId, list);
    }
  }

  let nextBacklog = backlogState.backlog;
  for (const backlogId of markers.linkedBacklogIds) {
    nextBacklog = repositoryBacklogFile.reconcileRepositoryBacklogItem(nextBacklog, {
      itemId: backlogId,
      roadmapIds: roadmapIdsByBacklogId.get(backlogId) || [],
      planRef,
      outcome,
    });
  }

  const savedBacklog = repositoryBacklogFile.updateRepositoryBacklogFile(repoRoot, nextBacklog);

  return {
    deterministic: true,
    sessionId: normalizeString(sessionId),
    planRef,
    outcome,
    linkedBacklogIds: markers.linkedBacklogIds,
    linkedRoadmapIds: markers.linkedRoadmapIds,
    backlog: {
      backlogPath: savedBacklog.backlogPath,
      changed: savedBacklog.changed,
      items: savedBacklog.backlog.items
        .filter((item) => markers.linkedBacklogIds.includes(item.id))
        .sort((left, right) => deterministicStringCompare(left.id, right.id)),
    },
    roadmaps: reconciledRoadmaps
      .map((roadmap) => ({
        slug: roadmap.slug,
        filePath: roadmap.filePath,
        repoRelativePath: roadmap.repoRelativePath,
        items: roadmap.items
          .filter((item) => markers.linkedRoadmapIds.includes(item.id))
          .sort((left, right) => deterministicStringCompare(left.id, right.id)),
      }))
      .sort((left, right) => deterministicStringCompare(left.slug, right.slug)),
  };
}

module.exports = {
  PLAN_SYNC_MARKER_NAMES,
  SESSION_PLAN_SYNC_OUTCOMES,
  buildDefaultPlanRef,
  inferSyncOutcomeFromStructuredState,
  parsePlanSyncMarkers,
  syncSessionPlanToRoadmap,
};
