'use strict';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRoadmapWorkflowStatus(status) {
  const normalized = normalizeString(status).toLowerCase();
  if (!normalized) return 'planned';
  if (normalized === 'in_progress') return 'in-progress';
  if (normalized === 'completed') return 'done';
  return normalized;
}

function deterministicStringCompare(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeIsoMs(value) {
  const text = normalizeString(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function toRoadmapWorkflowProjectionId(slug) {
  const normalized = normalizeString(slug).toLowerCase();
  return normalized ? `RM-${normalized}` : '';
}

function roadmapArtifactMatchesSlug(artifact, slug) {
  const normalizedSlug = normalizeString(slug).toLowerCase();
  const roadmapId = normalizeString(artifact && artifact.roadmapId);
  if (!normalizedSlug || !roadmapId) {
    return false;
  }
  const loweredRoadmapId = roadmapId.toLowerCase();
  return loweredRoadmapId === normalizedSlug || loweredRoadmapId === toRoadmapWorkflowProjectionId(normalizedSlug).toLowerCase();
}

function compareArtifactsNewestFirst(left, right) {
  const updatedDiff = (normalizeIsoMs(right && right.updatedAt) || 0) - (normalizeIsoMs(left && left.updatedAt) || 0);
  if (updatedDiff !== 0) return updatedDiff;
  const createdDiff = (normalizeIsoMs(right && right.createdAt) || 0) - (normalizeIsoMs(left && left.createdAt) || 0);
  if (createdDiff !== 0) return createdDiff;
  return deterministicStringCompare(left && left.artifactId, right && right.artifactId);
}

function normalizeAcceptance(value) {
  const source = value && typeof value === 'object' ? value : null;
  if (!source) return null;
  const failedChecks = Array.isArray(source.failedChecks)
    ? source.failedChecks.map((entry) => normalizeString(entry)).filter(Boolean).sort(deterministicStringCompare)
    : [];
  const passedChecks = Array.isArray(source.passedChecks)
    ? source.passedChecks.map((entry) => normalizeString(entry)).filter(Boolean).sort(deterministicStringCompare)
    : [];
  return {
    allPassed: source.allPassed === true,
    failedChecks,
    ...(passedChecks.length ? { passedChecks } : {}),
  };
}

function summarizeArtifact(artifact) {
  const structuredState = artifact && artifact.structuredState && typeof artifact.structuredState === 'object'
    ? artifact.structuredState
    : null;
  return {
    artifactId: normalizeString(artifact && artifact.artifactId),
    kind: normalizeString(artifact && artifact.kind),
    phase: normalizeString(artifact && artifact.phase),
    status: normalizeString(artifact && artifact.status),
    normalizedStatus: normalizeRoadmapWorkflowStatus(artifact && artifact.status),
    sourceHarness: normalizeString(artifact && artifact.sourceHarness) || null,
    sourceModel: normalizeString(artifact && artifact.sourceModel) || null,
    sessionId: normalizeString(artifact && artifact.sessionId) || null,
    updatedAt: normalizeString(artifact && artifact.updatedAt) || null,
    createdAt: normalizeString(artifact && artifact.createdAt) || null,
    requiresUserDecision: structuredState ? structuredState.requiresUserDecision === true : false,
    suggestedNextAction: structuredState ? normalizeString(structuredState.suggestedNextAction) || null : null,
    acceptance: structuredState ? normalizeAcceptance(structuredState.acceptance) : null,
  };
}

function buildSliceDesync(item, history) {
  const repoStatus = normalizeRoadmapWorkflowStatus(item && item.status);
  const latest = history[0] || null;
  const reasons = [];
  if (!latest) {
    reasons.push('workflow_slice_missing_for_repo_item');
    return {
      statusMismatch: false,
      roadmapStatus: repoStatus,
      workflowStatus: null,
      reasons,
    };
  }

  if (latest.normalizedStatus !== repoStatus) {
    reasons.push('status_mismatch');
  }
  if (latest.requiresUserDecision) {
    reasons.push('requires_user_decision_pending');
  }
  if (
    latest.acceptance
    && latest.acceptance.allPassed === false
    && latest.acceptance.failedChecks.length > 0
  ) {
    reasons.push('acceptance_mismatch');
  }
  if (
    (latest.kind === 'roadmap.completion.result' || latest.normalizedStatus === 'done')
    && repoStatus !== 'done'
  ) {
    reasons.push('terminal_workflow_not_reflected_in_repo');
  }

  return {
    statusMismatch: reasons.includes('status_mismatch'),
    roadmapStatus: repoStatus,
    workflowStatus: latest.normalizedStatus,
    reasons: [...new Set(reasons)].sort(deterministicStringCompare),
  };
}

function buildRoadmapWorkflowProjection(roadmap, artifacts) {
  const sourceRoadmap = roadmap && typeof roadmap === 'object' ? roadmap : {};
  const items = Array.isArray(sourceRoadmap.items) ? sourceRoadmap.items : [];
  const matchingArtifacts = (Array.isArray(artifacts) ? artifacts : [])
    .filter((artifact) => roadmapArtifactMatchesSlug(artifact, sourceRoadmap.slug))
    .slice()
    .sort(compareArtifactsNewestFirst);

  const historyBySliceId = new Map();
  for (const artifact of matchingArtifacts) {
    const sliceId = normalizeString(artifact && artifact.sliceId);
    if (!sliceId) {
      continue;
    }
    const list = historyBySliceId.get(sliceId) || [];
    list.push(summarizeArtifact(artifact));
    historyBySliceId.set(sliceId, list);
  }

  let desyncCount = 0;
  const projectedItems = items.map((item) => {
    const history = historyBySliceId.get(item.id) || [];
    const desync = buildSliceDesync(item, history);
    if (desync.reasons.length > 0) {
      desyncCount += 1;
    }
    return {
      ...item,
      workflowProjection: {
        history,
        latest: history[0] || null,
      },
      desync,
    };
  });

  const matchedSliceIds = new Set(projectedItems.map((item) => normalizeString(item.id)).filter(Boolean));
  const unmatchedWorkflowArtifacts = [...historyBySliceId.entries()]
    .filter(([sliceId]) => !matchedSliceIds.has(sliceId))
    .map(([sliceId, history]) => ({
      sliceId,
      history,
      reasons: ['repo_item_missing_for_slice'],
    }))
    .sort((left, right) => deterministicStringCompare(left.sliceId, right.sliceId));

  return {
    ...sourceRoadmap,
    items: projectedItems,
    workflowProjection: {
      artifactCount: matchingArtifacts.length,
      projectedItemCount: projectedItems.filter((item) => item.workflowProjection.latest).length,
      desyncCount,
      synced: desyncCount === 0 && unmatchedWorkflowArtifacts.length === 0,
      unmatchedWorkflowArtifacts,
    },
  };
}

module.exports = {
  buildRoadmapWorkflowProjection,
  compareArtifactsNewestFirst,
  normalizeRoadmapWorkflowStatus,
  roadmapArtifactMatchesSlug,
  summarizeArtifact,
  toRoadmapWorkflowProjectionId,
};
