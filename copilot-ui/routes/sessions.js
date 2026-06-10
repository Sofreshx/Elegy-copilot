'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sessionsLib = require('../lib/sessions');
const assetsLib = require('../lib/assets');
const assetInvocationAuditLib = require('../lib/assetInvocationAudit');
const planStateLib = require('../lib/planState');
const repoInventoryLib = require('../lib/repoInventoryService');
const roadmapArtifactsLib = require('../lib/roadmapArtifacts');
const repositoryBacklogFileLib = require('../lib/repositoryBacklogFile');
const sessionPlanRoadmapSyncLib = require('../lib/sessionPlanRoadmapSync');
const continuationPackagesLib = require('../lib/continuationPackages');
const {
  SESSION_RECONCILIATION_CONTRACT_VERSION,
  SESSION_RECONCILIATION_SOURCES,
  SESSION_STATE_AUTHORITIES,
  buildSessionOrchestrationProjection,
  normalizeActorRole,
  normalizeSessionOrchestrationActor,
} = require('../lib/runtimeContracts');
const sessionArtifactsLib = require('../lib/sessionArtifacts');
const sessionAggregationLib = require('../lib/sessionAggregation');
const { sendJson: defaultSendJson, sendText: defaultSendText, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const SANDBOX_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

function parseNumberQuery(searchParams, key, defaultValue) {
  const v = searchParams.get(key);
  if (v == null || v === '') return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  return n;
}

function resolveSessionsHome(source, elegyHome, sandboxesHome) {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'sandbox') return { source: 'sandbox', home: sandboxesHome };
  return { source: 'cli', home: elegyHome };
}

function resolveSessionRequestHome(ctx, deps, source) {
  const { u, elegyHome, sandboxesHome } = ctx;
  const { resolveSessionsHome, path } = deps;
  const home = resolveSessionsHome(source, elegyHome, sandboxesHome);
  if (home.source !== 'sandbox') {
    return home;
  }

  const sandboxId = normalizeString(u && u.searchParams ? u.searchParams.get('sandbox') : '');
  if (!sandboxId) {
    const error = new Error('Missing sandbox id');
    error.statusCode = 400;
    throw error;
  }
  if (!SANDBOX_ID_PATTERN.test(sandboxId)) {
    const error = new Error('sandboxId must use only alphanumeric and hyphen characters');
    error.statusCode = 400;
    throw error;
  }

  const sandboxHome = normalizeString(home.home);
  if (!sandboxHome) {
    const error = new Error('Sandbox root is unavailable on the server.');
    error.statusCode = 503;
    throw error;
  }

  return {
    ...home,
    sandbox: sandboxId,
    home: path.resolve(sandboxHome, sandboxId),
  };
}

function resolveSessionRequestDir(ctx, deps, id, source) {
  const home = resolveSessionRequestHome(ctx, deps, source);
  return {
    home,
    sessionDir: deps.path.join(deps.path.resolve(home.home), 'session-state', id),
  };
}

function isValidSessionId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeString(value);
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

const TERMINAL_EXECUTION_STATE_TOKENS = new Set([
  'aborted',
  'canceled',
  'cancelled',
  'closed',
  'complete',
  'completed',
  'done',
  'error',
  'failed',
  'finished',
  'stopped',
  'terminated',
]);
const CANONICAL_VALIDATION_CLOSEOUT_LABELS = new Set([
  'unit',
  'integration',
  'e2e',
  'browser',
  'playwright',
  'manual',
]);
const VALIDATION_LAYER_MENTION_PATTERN = /\b(unit|integration|e2e|browser|playwright|manual)\b/i;
const VALIDATION_GAP_SIGNAL_PATTERN = /\b(required|missing|blocked|blocker|not run|did not run|unresolved|pending|absent|incomplete)\b/i;
const VALIDATION_MANDATORY_SIGNAL_PATTERN = /\b(required|mandatory|must run|must be run)\b/i;
const VALIDATION_NOT_REQUIRED_SIGNAL_PATTERN = /\b(not required|optional|waived|waiver|not needed|not necessary|not applicable|n\/a)\b/i;

function isTerminalExecutionState(executionState) {
  if (!executionState || typeof executionState !== 'object') {
    return false;
  }

  const lifecycle = normalizeString(executionState.lifecycle).toLowerCase();
  const status = normalizeString(executionState.status).toLowerCase();
  return TERMINAL_EXECUTION_STATE_TOKENS.has(lifecycle) || TERMINAL_EXECUTION_STATE_TOKENS.has(status);
}

function hasCompatibilityFinalCloseoutEvidence(executionState) {
  return isTerminalExecutionState(executionState);
}

function getCanonicalValidationCloseoutLabel(item) {
  const normalized = normalizeString(item);
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0) {
    return '';
  }

  const label = normalized.slice(0, separatorIndex).trim().toLowerCase();
  return CANONICAL_VALIDATION_CLOSEOUT_LABELS.has(label) ? label : '';
}

function isValidationRelatedCloseoutItem(item) {
  const normalized = normalizeString(item);
  if (!normalized) {
    return false;
  }

  if (getCanonicalValidationCloseoutLabel(normalized)) {
    return true;
  }

  return /(validation|coverage|test|verify|verification)/i.test(normalized)
    || (VALIDATION_LAYER_MENTION_PATTERN.test(normalized) && VALIDATION_GAP_SIGNAL_PATTERN.test(normalized));
}

function buildUnresolvedUnlabeledValidationGap(item) {
  return `Unlabeled mandatory validation requirement remains unresolved: ${normalizeString(item)}`;
}

function buildMissingLabeledValidationGap(label) {
  return `${normalizeString(label).toLowerCase()}: Required validation coverage is still missing.`;
}

function isMandatoryValidationRequirement(item) {
  const normalized = normalizeString(item);
  if (!normalized) {
    return false;
  }

  if (VALIDATION_NOT_REQUIRED_SIGNAL_PATTERN.test(normalized)) {
    return false;
  }

  return VALIDATION_MANDATORY_SIGNAL_PATTERN.test(normalized);
}

function collectCanonicalValidationCloseoutLabels(items) {
  const labels = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const label = getCanonicalValidationCloseoutLabel(item);
    if (label) {
      labels.add(label);
    }
  }
  return labels;
}

function normalizePlanContent(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\r\n/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function formatEventCreatedAt(event) {
  const raw = event && (event.timestamp || event.time || event.ts || event.createdAt || event.at || event.date);
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function buildTranscriptExcerptFromEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => {
      const type = normalizeString(event && (event.type || event.event || event.name)).toLowerCase();
      const payload = event && typeof event === 'object'
        ? (event.payload || event.data || event)
        : {};
      if (type !== 'user.message' && type !== 'assistant.message') {
        return null;
      }
      const content = normalizeString(payload && payload.content);
      if (!content) {
        return null;
      }
      return {
        role: type === 'user.message' ? 'user' : 'assistant',
        content,
        createdAt: formatEventCreatedAt(event),
      };
    })
    .filter(Boolean);
}

function parsePlanRoadmapMarkers(planText, sessionPlanRoadmapSync) {
  if (!sessionPlanRoadmapSync || typeof sessionPlanRoadmapSync.parsePlanSyncMarkers !== 'function') {
    return null;
  }
  try {
    return sessionPlanRoadmapSync.parsePlanSyncMarkers(planText || '');
  } catch {
    return null;
  }
}

function buildSessionContinuationPackage(ctx, deps, input) {
  const structuredState = input && input.structuredState && typeof input.structuredState === 'object'
    ? input.structuredState
    : {};
  const orchestration = input && input.orchestration && typeof input.orchestration === 'object'
    ? input.orchestration
    : {};
  const meta = structuredState.meta && typeof structuredState.meta === 'object'
    ? structuredState.meta
    : {};
  const intentFrame = meta.intentFrame && typeof meta.intentFrame === 'object' ? meta.intentFrame : {};
  const closureSummary = meta.closureSummary && typeof meta.closureSummary === 'object' ? meta.closureSummary : {};
  const repo = orchestration.repo && typeof orchestration.repo === 'object' ? orchestration.repo : {};
  const workflow = orchestration.workflow && typeof orchestration.workflow === 'object' ? orchestration.workflow : {};
  const planMarkers = parsePlanRoadmapMarkers(input.planText, deps.sessionPlanRoadmapSync);
  const targetHarness = deps.continuationPackages.normalizeTargetHarness(
    normalizeString(input.targetHarness || (ctx.u && ctx.u.searchParams && ctx.u.searchParams.get('targetHarness')) || 'opencode')
  );
  const roadmapIds = uniqueStrings([
    ...(planMarkers && Array.isArray(planMarkers.linkedRoadmapIds) ? planMarkers.linkedRoadmapIds : []),
    ...(Array.isArray(closureSummary.roadmapIds) ? closureSummary.roadmapIds : []),
  ]);

  const constraints = uniqueStrings([
    ...(Array.isArray(intentFrame.constraints) ? intentFrame.constraints : []),
    ...(Array.isArray(intentFrame.watchOuts) ? intentFrame.watchOuts : []),
    ...(Array.isArray(closureSummary.limitations) ? closureSummary.limitations : []),
  ]);
  const openQuestions = uniqueStrings([
    ...(Array.isArray(meta.resume && meta.resume.blockers) ? meta.resume.blockers : []),
    ...(Array.isArray(closureSummary.blockers) ? closureSummary.blockers : []),
    ...(Array.isArray(closureSummary.coverageGaps) ? closureSummary.coverageGaps : []),
  ]);
  const nextActions = uniqueStrings([
    ...(Array.isArray(closureSummary.followUps && closureSummary.followUps.activeContinuation)
      ? closureSummary.followUps.activeContinuation
      : []),
    ...(Array.isArray(intentFrame.nextSuggestedUnits) ? intentFrame.nextSuggestedUnits : []),
    ...(Array.isArray(intentFrame.inScope) ? intentFrame.inScope : []),
  ]);
  const carryover = uniqueStrings([
    ...(Array.isArray(closureSummary.followUps && closureSummary.followUps.durableCarryover)
      ? closureSummary.followUps.durableCarryover
      : []),
    ...(Array.isArray(intentFrame.carryoverSignals) ? intentFrame.carryoverSignals : []),
    ...(Array.isArray(intentFrame.outOfScope) ? intentFrame.outOfScope : []),
  ]);
  const skillsRequired = uniqueStrings([
    'implementation-handoff',
    ...(roadmapIds.length > 0 ? ['roadmap-planning'] : []),
    ...(closureSummary.outcome === 'completed' ? ['implementation-review'] : []),
  ]);
  const sourceArtifacts = uniqueStrings([
    ...(Array.isArray(intentFrame.sourceArtifacts) ? intentFrame.sourceArtifacts : []),
    ...(Array.isArray(closureSummary.sourceArtifacts) ? closureSummary.sourceArtifacts : []),
  ]);

  return deps.continuationPackages.buildSessionContinuationPackage({
    kind: 'session.continuation-package',
    targetHarness,
    source: {
      kind: 'session',
      sessionId: input.sessionId,
      harness: 'copilot',
      sessionSource: input.source,
      model: normalizeString(workflow.model) || null,
    },
    repo: {
      repoId: normalizeString(repo.repoId) || null,
      repoPath: normalizeString(repo.repoPath) || null,
      repoLabel: normalizeString(repo.repoLabel) || null,
      branch: normalizeString(repo.branch) || null,
    },
    roadmap: roadmapIds.length > 0 || (planMarkers && planMarkers.planRef)
      ? {
          roadmapId: roadmapIds[0] || null,
          roadmapIds,
          sliceId: null,
          planRef: planMarkers && planMarkers.planRef ? planMarkers.planRef : null,
          linkedBacklogIds: planMarkers && Array.isArray(planMarkers.linkedBacklogIds) ? planMarkers.linkedBacklogIds : [],
        }
      : null,
    objective: normalizeString(orchestration.objective) || normalizeString(intentFrame.summary) || null,
    summary: normalizeString(closureSummary.summary) || normalizeString(intentFrame.summary) || null,
    constraints,
    openQuestions,
    nextActions,
    carryover,
    skillsRequired,
    sourceArtifacts,
    transcriptExcerpt: input.transcriptExcerpt,
  });
}

function buildGeneratedSessionId(cryptoLib) {
  if (cryptoLib && typeof cryptoLib.randomUUID === 'function') {
    return `planning-${cryptoLib.randomUUID()}`;
  }

  return `planning-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function appendJsonLine(fsLib, filePath, value) {
  fsLib.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function firstDefined(...values) {
  for (const value of values) {
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

function normalizeRepoSelector(searchParams, body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const repoId = normalizeString(firstDefined(source.repoId, searchParams && searchParams.get('repoId')));
  const repoPath = normalizeString(firstDefined(source.repoPath, searchParams && searchParams.get('repoPath')));
  return {
    ...(repoId ? { repoId } : {}),
    ...(repoPath ? { repoPath } : {}),
  };
}

function resolveRepoContext(ctx, deps, selector) {
  const inventory = deps.repoInventory.listKnownRepos({
    elegyHome: ctx.elegyHomeAbs || ctx.elegyHome,
    engineRoot: ctx.engineRoot,
    explicitRepoPaths: selector.repoPath ? [selector.repoPath] : [],
  });
  const repo = deps.repoInventory.resolveRepoEntry(inventory, selector);
  if (!repo || !repo.repoPath) {
    throw Object.assign(new Error('Catalog repo selection is required for roadmap sync'), {
      statusCode: 409,
      code: 'catalog_repo_not_selected',
      reason: 'catalog_repo_not_selected',
    });
  }
  return repo;
}

function uniqueArchiveDir(baseArchiveDir, id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9_.-]/g, '_');
  const first = path.join(baseArchiveDir, safe);
  if (!fs.existsSync(first)) return first;
  for (let i = 2; i < 10000; i++) {
    const candidate = path.join(baseArchiveDir, `${safe}--archived-${i}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Unable to allocate archive folder');
}

function buildSessionsListResponse(data, options = {}) {
  const source = String(options.source || 'cli').trim().toLowerCase() || 'cli';
  const dedupe = String(options.dedupe || 'on').trim().toLowerCase() || 'on';

  let listingSurface = 'artifact_inventory';
  if (source === 'all' && dedupe === 'off') {
    listingSurface = 'artifact_inventory_multi_source';
  } else if (source === 'all') {
    listingSurface = 'artifact_inventory_deduped';
  } else if (source === 'sandbox') {
    listingSurface = 'artifact_inventory_sandbox';
  }

  return {
    sessions: Array.isArray(data) ? data : [],
    authorityModel: {
      contractVersion: SESSION_RECONCILIATION_CONTRACT_VERSION,
      liveAuthority: SESSION_STATE_AUTHORITIES.RUNTIME,
      artifactFallbackAuthority: SESSION_STATE_AUTHORITIES.ARTIFACT,
      runtimeSourceOfTruth: SESSION_RECONCILIATION_SOURCES.RUNTIME,
      artifactSourceOfTruth: SESSION_RECONCILIATION_SOURCES.ARTIFACT,
      listingSurface,
      artifactAccessRole: 'archive_offline',
    },
  };
}

function toWorkspaceTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sourceLabelForWorkspace(source) {
  const normalized = normalizeString(source).toLowerCase();
  if (normalized === 'cli') return 'CLI';
  if (normalized === 'sandbox') return 'Sandbox';
  if (normalized === 'sdk') return 'SDK';
  if (normalized === 'overlay') return 'Overlay';
  if (normalized === 'archive') return 'Archive';
  return normalized ? normalized.toUpperCase() : 'Unknown';
}

function inferRepoLabel(repoId, repoPath, repoLabel, pathLib = path) {
  const explicit = normalizeString(repoLabel);
  if (explicit) return explicit;
  const resolvedPath = normalizeString(repoPath);
  if (resolvedPath) {
    const base = normalizeString(pathLib.basename(resolvedPath));
    if (base) return base;
  }
  return normalizeString(repoId) || null;
}

function buildWorkspaceRepoSummary(input, pathLib = path) {
  const source = input && typeof input === 'object' ? input : {};
  const repoId = normalizeString(source.repoId);
  const repoPath = normalizeString(source.repoPath);
  const repoLabel = inferRepoLabel(repoId, repoPath, source.repoLabel, pathLib);
  if (!repoId && !repoPath && !repoLabel) {
    return null;
  }
  return {
    repoId: repoId || null,
    repoPath: repoPath || null,
    repoLabel: repoLabel || null,
  };
}

function buildWorkspaceRepoModel(primaryRepo, linkedRepos = [], pathLib = path) {
  const normalizedPrimary = buildWorkspaceRepoSummary(primaryRepo, pathLib);
  const deduped = [];
  const seen = new Set();
  for (const candidate of Array.isArray(linkedRepos) ? linkedRepos : []) {
    const normalized = buildWorkspaceRepoSummary(candidate, pathLib);
    if (!normalized) continue;
    const key = `${normalized.repoId || ''}|${normalized.repoPath || ''}|${normalized.repoLabel || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }
  return {
    primaryRepo: normalizedPrimary,
    linkedRepos: deduped,
  };
}

function normalizeArtifactWorkspaceStatus(session) {
  return normalizeString(session && (session.resolvedStatus || session.status)).toLowerCase() || 'missing';
}

function normalizeRuntimeWorkspaceStatus(status, fallback = 'active') {
  const normalized = normalizeString(status).toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'attached' || normalized === 'open' || normalized === 'running') return 'active';
  if (normalized === 'closed') return 'closed';
  return normalized;
}

function buildArtifactWorkspaceEntry(session, pathLib = path) {
  const normalizedSource = normalizeString(session && session.source).toLowerCase() || 'cli';
  const workspace = buildWorkspaceRepoModel({
    repoId: session && session.repo,
    repoPath: session && session.cwd,
    repoLabel: null,
  }, [], pathLib);
  return {
    entryId: `artifact:${normalizedSource}:${normalizeString(session && session.id)}`,
    sessionId: normalizeString(session && session.id) || null,
    linkedSessionId: null,
    kind: 'artifact',
    title: normalizeString(session && session.id) || 'Unnamed session',
    status: normalizeArtifactWorkspaceStatus(session),
    source: normalizedSource,
    sourceLabel: sourceLabelForWorkspace(normalizedSource),
    startedAt: session && session.startTime != null ? session.startTime : null,
    updatedAt: session && session.lastEventTime != null ? session.lastEventTime : null,
    workspace,
    detail: {
      source: normalizedSource,
      sandbox: normalizeString(session && session.sandbox) || null,
      canOpenArtifacts: normalizedSource === 'cli',
      handoffTarget: 'session-detail',
    },
    runtimeAuthority: false,
    durable: true,
    archive: false,
  };
}

function buildArchiveWorkspaceEntry(session, pathLib = path) {
  const normalizedSource = normalizeString(session && session.source).toLowerCase() || 'cli';
  const workspace = buildWorkspaceRepoModel({
    repoId: session && session.repo,
    repoPath: session && session.cwd,
    repoLabel: null,
  }, [], pathLib);
  return {
    entryId: `archive:${normalizedSource}:${normalizeString(session && (session.archiveId || session.id))}`,
    sessionId: normalizeString(session && session.id) || null,
    linkedSessionId: null,
    kind: 'archive',
    title: normalizeString(session && session.id) || 'Archived session',
    status: 'archived',
    source: normalizedSource,
    sourceLabel: sourceLabelForWorkspace('archive'),
    startedAt: session && session.startTime != null ? session.startTime : null,
    updatedAt: session && session.lastEventTime != null ? session.lastEventTime : null,
    workspace,
    detail: {
      source: normalizedSource,
      sandbox: normalizeString(session && session.sandbox) || null,
      canOpenArtifacts: false,
      handoffTarget: 'history',
    },
    runtimeAuthority: false,
    durable: true,
    archive: true,
    archiveId: normalizeString(session && session.archiveId) || normalizeString(session && session.id) || null,
  };
}

function buildSdkWorkspaceEntry(session, pathLib = path) {
  const orchestrationRepo = session && session.orchestration && typeof session.orchestration === 'object'
    ? session.orchestration.repo
    : null;
  const workspace = buildWorkspaceRepoModel({
    repoId: orchestrationRepo && orchestrationRepo.repoId,
    repoPath: (orchestrationRepo && orchestrationRepo.repoPath) || (session && session.cwd),
    repoLabel: orchestrationRepo && orchestrationRepo.repoLabel,
  }, [], pathLib);
  const sessionId = normalizeString(session && session.sessionId);
  return {
    entryId: `sdk:${sessionId}`,
    sessionId: sessionId || null,
    linkedSessionId: null,
    kind: 'sdk',
    title: sessionId || 'SDK session',
    status: normalizeRuntimeWorkspaceStatus(session && session.status, 'active'),
    source: 'sdk',
    sourceLabel: sourceLabelForWorkspace('sdk'),
    startedAt: session && session.createdAt != null ? session.createdAt : null,
    updatedAt: session && session.updatedAt != null ? session.updatedAt : (session && session.createdAt != null ? session.createdAt : null),
    workspace,
    detail: {
      source: 'sdk',
      sandbox: normalizeString(session && session.sandboxId) || null,
      canOpenArtifacts: false,
      handoffTarget: 'sdk',
    },
    runtimeAuthority: true,
    durable: false,
    archive: false,
  };
}

function buildOverlayWorkspaceEntry(session, pathLib = path) {
  const overlayId = normalizeString(session && session.id);
  const linkedSessionId = normalizeString(session && session.linkedSessionId);
  const workspace = buildWorkspaceRepoModel({
    repoId: session && session.repoId,
    repoPath: session && session.repoPath,
    repoLabel: session && session.repoLabel,
  }, [], pathLib);
  return {
    entryId: `overlay:${overlayId}`,
    sessionId: overlayId || null,
    linkedSessionId: linkedSessionId || null,
    kind: 'overlay',
    title: overlayId || 'Overlay session',
    status: normalizeRuntimeWorkspaceStatus(session && session.status, 'active'),
    source: 'overlay',
    sourceLabel: sourceLabelForWorkspace('overlay'),
    startedAt: session && session.createdAt != null ? session.createdAt : null,
    updatedAt: session && session.updatedAt != null ? session.updatedAt : (session && session.createdAt != null ? session.createdAt : null),
    workspace,
    detail: {
      source: 'overlay',
      sandbox: null,
      canOpenArtifacts: false,
      handoffTarget: 'overlay',
    },
    runtimeAuthority: true,
    durable: true,
    archive: false,
  };
}

function sortWorkspaceEntries(entries) {
  return entries
    .slice()
    .sort((left, right) => {
      if (left.runtimeAuthority !== right.runtimeAuthority) {
        return left.runtimeAuthority ? -1 : 1;
      }
      const timestampDelta = toWorkspaceTimestamp(right.updatedAt || right.startedAt) - toWorkspaceTimestamp(left.updatedAt || left.startedAt);
      if (timestampDelta !== 0) {
        return timestampDelta;
      }
      return String(left.title || left.entryId).localeCompare(String(right.title || right.entryId));
    });
}

function listWorkspaceArtifactSessions(ctx, deps, activeWindowMinutes) {
  const { elegyHome, sandboxesHome } = ctx;
  const cli = deps.sessions.listSessions(elegyHome, { activeWindowMinutes, recentLimit: 250 })
    .map((session) => ({ ...session, source: 'cli' }));
  const sandbox = deps.sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 });
  const all = [...cli, ...sandbox];
  return typeof deps.sessions.dedupeAllSources === 'function'
    ? deps.sessions.dedupeAllSources(all)
    : all.map((session) => (typeof deps.sessions.applySessionReconciliation === 'function'
      ? deps.sessions.applySessionReconciliation(session)
      : session));
}

function listWorkspaceArchivedSessions(ctx, deps, activeWindowMinutes) {
  const { elegyHome, sandboxesHome } = ctx;
  const listArchivedSessions = typeof deps.sessions.listArchivedSessions === 'function'
    ? deps.sessions.listArchivedSessions.bind(deps.sessions)
    : null;
  const listSandboxArchivedSessions = typeof deps.sessions.listSandboxArchivedSessions === 'function'
    ? deps.sessions.listSandboxArchivedSessions.bind(deps.sessions)
    : null;
  if (!listArchivedSessions) {
    return [];
  }

  const cli = listArchivedSessions(elegyHome, { activeWindowMinutes, recentLimit: 250 })
    .map((session) => ({ ...session, source: 'cli' }));
  const sandbox = listSandboxArchivedSessions
    ? listSandboxArchivedSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 })
    : [];
  return [...cli, ...sandbox];
}

function buildSessionsWorkspaceResponse(active, history) {
  return {
    active: sortWorkspaceEntries(active),
    history: sortWorkspaceEntries(history),
    authorityModel: {
      contractVersion: SESSION_RECONCILIATION_CONTRACT_VERSION,
      activeAuthority: SESSION_STATE_AUTHORITIES.RUNTIME,
      historyAuthority: SESSION_STATE_AUTHORITIES.ARTIFACT,
      runtimeSourceOfTruth: SESSION_RECONCILIATION_SOURCES.RUNTIME,
      artifactSourceOfTruth: SESSION_RECONCILIATION_SOURCES.ARTIFACT,
      activeSurface: 'runtime_first_workspace',
      historySurface: 'artifact_archive_history',
      multiRepoModel: 'primary_plus_linked',
    },
  };
}

function handleSessionsWorkspace(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const activeWindowMinutes = parseNumberQuery(u.searchParams, 'activeWindowMinutes', 30);

  const artifactSessions = listWorkspaceArtifactSessions(ctx, deps, activeWindowMinutes);
  const archivedSessions = listWorkspaceArchivedSessions(ctx, deps, activeWindowMinutes);

  Promise.all([
    Promise.resolve()
      .then(() => (deps.sdkBridge && typeof deps.sdkBridge.listSdkSessions === 'function' ? deps.sdkBridge.listSdkSessions() : []))
      .catch(() => []),
    Promise.resolve()
      .then(() => (deps.uiRuntimeOverlayService && typeof deps.uiRuntimeOverlayService.listSessions === 'function'
        ? deps.uiRuntimeOverlayService.listSessions()
        : []))
      .catch(() => []),
  ])
    .then(([sdkSessions, overlaySessions]) => {
      const runtimeEntries = [
        ...sdkSessions.map((session) => buildSdkWorkspaceEntry(session, deps.path)),
        ...overlaySessions
          .filter((session) => normalizeRuntimeWorkspaceStatus(session && session.status, 'active') === 'active')
          .map((session) => buildOverlayWorkspaceEntry(session, deps.path)),
      ];

      const runtimeSessionIds = new Set(
        runtimeEntries
          .flatMap((entry) => [entry.sessionId, entry.linkedSessionId])
          .map((value) => normalizeString(value).toLowerCase())
          .filter(Boolean)
      );

      const activeArtifactEntries = artifactSessions
        .filter((session) => normalizeArtifactWorkspaceStatus(session) === 'active')
        .filter((session) => {
          const sessionId = normalizeString(session && session.id).toLowerCase();
          return !sessionId || !runtimeSessionIds.has(sessionId);
        })
        .map((session) => buildArtifactWorkspaceEntry(session, deps.path));

      const historyArtifactEntries = artifactSessions
        .filter((session) => normalizeArtifactWorkspaceStatus(session) !== 'active')
        .filter((session) => {
          const sessionId = normalizeString(session && session.id).toLowerCase();
          return !sessionId || !runtimeSessionIds.has(sessionId);
        })
        .map((session) => buildArtifactWorkspaceEntry(session, deps.path));
      const historyArchiveEntries = archivedSessions
        .filter((session) => {
          const sessionId = normalizeString(session && session.id).toLowerCase();
          return !sessionId || !runtimeSessionIds.has(sessionId);
        })
        .map((session) => buildArchiveWorkspaceEntry(session, deps.path));

      sendJson(res, 200, buildSessionsWorkspaceResponse(
        [...runtimeEntries, ...activeArtifactEntries],
        [...historyArtifactEntries, ...historyArchiveEntries]
      ));
    })
    .catch((error) => {
      sendJson(res, error && error.statusCode ? error.statusCode : 500, {
        error: String((error && error.message) || error || 'Unable to build sessions workspace'),
      });
    });
}

function handleSessionsList(ctx, deps) {
  const { req, res, u, elegyHome, sandboxesHome } = ctx;
  const { sendJson, parseNumberQuery, resolveSessionsHome, sessions } = deps;

  const activeWindowMinutes = parseNumberQuery(u.searchParams, 'activeWindowMinutes', 30);
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  if (source === 'all') {
    const dedupe = (u.searchParams.get('dedupe') || 'on').toLowerCase();
    const cli = sessions.listSessions(elegyHome, { activeWindowMinutes, recentLimit: 250 })
      .map((s) => ({ ...s, source: 'cli' }));
    const sandbox = sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 });
    const all = [...cli, ...sandbox];
    const result = (dedupe === 'off')
      ? all.map((s) => sessions.applySessionReconciliation({
        ...s,
        ...sessions.buildSessionIdentity(s),
      }))
      : sessions.dedupeAllSources(all);
    sendJson(res, 200, buildSessionsListResponse(result, { source, dedupe }));
    return;
  }
  if (source === 'sandbox') {
    const data = sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 })
      .map((s) => sessions.applySessionReconciliation(s));
    sendJson(res, 200, buildSessionsListResponse(data, { source }));
    return;
  }
  const home = resolveSessionsHome(source, elegyHome, sandboxesHome);
  const data = sessions.listSessions(home.home, { activeWindowMinutes, recentLimit: 250 })
    .map((s) => sessions.applySessionReconciliation({ ...s, source: home.source }));
  sendJson(res, 200, buildSessionsListResponse(data, { source: home.source }));
}

function handleSessionEvents(ctx, deps) {
  const { req, res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, parseNumberQuery, resolveSessionsHome, isValidSessionId, sessions, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 20))));
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const events = sessions.readRecentEvents(sessionDir, limit);
    sendJson(res, 200, { id, source: home.source, events });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionAgentUsage(ctx, deps) {
  const { req, res, u, match, elegyHome, sandboxesHome } = ctx;
  const {
    sendJson,
    parseNumberQuery,
    resolveSessionsHome,
    isValidSessionId,
    sessions,
    assetInvocationAudit,
    path,
  } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 500))));
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const usage = sessions.getAgentUsage(sessionDir, limit);
    const skillUsage = assetInvocationAudit.getSessionSkillUsageSummary({
      elegyHome: path.resolve(home.home),
      sessionId: id,
      limit: Math.max(limit * 4, 200),
    });
    sendJson(res, 200, { id, source: home.source, usage, skillUsage });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionPlan(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, sendText, resolveSessionsHome, isValidSessionId, assets, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const planPath = path.join(sessionDir, 'plan.md');
    const text = assets.readTextFileSafe(planPath, 512 * 1024);
    if (text == null) {
      sendText(res, 404, 'Not found');
      return;
    }
    sendText(res, 200, text, 'text/plain; charset=utf-8');
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function handleSessionPlanMutation(ctx, deps) {
  const { req, res, u, elegyHome, sandboxesHome } = ctx;
  const {
    sendJson,
    readJsonBody,
    isValidSessionId,
    ensureDir,
    fs,
    path,
    crypto,
  } = deps;

  readJsonBody(req)
    .then((body) => {
      const requestBody = body && typeof body === 'object' ? body : {};
      const requestSource = normalizeString(firstDefined(requestBody.source, u.searchParams.get('source'))).toLowerCase();
      const home = resolveSessionRequestHome(ctx, deps, requestSource || 'cli');
      const requestedSessionId = normalizeString(requestBody.sessionId);
      const sessionId = requestedSessionId || buildGeneratedSessionId(crypto);

      if (!isValidSessionId(sessionId)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return;
      }

      const content = normalizePlanContent(requestBody.content);
      if (!content.trim()) {
        sendJson(res, 400, { error: 'Plan content is required' });
        return;
      }

      const repoId = normalizeString(requestBody.repoId);
      const repoPath = normalizeString(requestBody.repoPath);
      const title = normalizeString(requestBody.title);
      const seedArtifact = requestBody.seedArtifact && typeof requestBody.seedArtifact === 'object'
        ? requestBody.seedArtifact
        : null;
      const seedArtifactId = normalizeString(seedArtifact && seedArtifact.id);
      const seedArtifactCategory = normalizeString(seedArtifact && seedArtifact.category);
      const seedArtifactTitle = normalizeString(seedArtifact && seedArtifact.title);

      const sessionDir = path.join(path.resolve(home.home), 'session-state', sessionId);
      const planPath = path.join(sessionDir, 'plan.md');
      const eventsPath = path.join(sessionDir, 'events.jsonl');
      const created = !fs.existsSync(sessionDir);
      const wroteStartEvent = created || !fs.existsSync(eventsPath);
      const timestamp = new Date().toISOString();

      ensureDir(sessionDir);

      if (wroteStartEvent) {
        appendJsonLine(fs, eventsPath, {
          type: 'session.start',
          time: timestamp,
          payload: {
            sessionId,
            source: 'instruction-engine-ui',
            mode: 'planning',
            startTime: timestamp,
            cwd: repoPath || null,
            repo: repoId || null,
          },
        });
      }

      fs.writeFileSync(planPath, content, 'utf8');
      appendJsonLine(fs, eventsPath, {
        type: 'session.plan_updated',
        time: timestamp,
        payload: {
          sessionId,
          title: title || null,
          updatedAt: timestamp,
          repoId: repoId || null,
          repoPath: repoPath || null,
          seededFromArtifactId: seedArtifactId || null,
          seededFromArtifactCategory: seedArtifactCategory || null,
          seededFromArtifactTitle: seedArtifactTitle || null,
        },
      });

      sendJson(res, 200, {
        sessionId,
        source: home.source,
        planPath,
        created,
        updatedAt: timestamp,
        content,
        linkedRepoId: repoId || undefined,
        linkedRepoPath: repoPath || undefined,
        seededFromArtifactId: seedArtifactId || null,
      });
    })
    .catch((error) => {
      sendJson(res, 400, { error: String(error.message || error) });
    });
}

function handleSessionPlans(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, listPlanArtifacts, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }
    const plans = listPlanArtifacts(sessionDir);
    sendJson(res, 200, { id, source: home.source, plans });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionPlanById(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, sendText, resolveSessionsHome, isValidSessionId, readPlanArtifact, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const planId = decodeURIComponent(match[2]);
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const text = readPlanArtifact(sessionDir, planId);
    if (text == null) {
      sendText(res, 404, 'Not found');
      return;
    }
    sendText(res, 200, text, 'text/plain; charset=utf-8');
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function handleSessionFinal(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const {
    sendJson,
    sendText,
    resolveSessionsHome,
    isValidSessionId,
    assets,
    fs,
    path,
    readPlanArtifact,
    planState,
  } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const finalPath = path.join(sessionDir, 'final.md');
    const legacyFinalText = assets.readTextFileSafe(finalPath, 2 * 1024 * 1024);
    let compatibilityFinal = null;

    try {
      if (fs.existsSync(sessionDir) && fs.statSync(sessionDir).isDirectory()
        && typeof readPlanArtifact === 'function'
        && planState
        && typeof planState.parseStructuredState === 'function') {
        const planText = readPlanArtifact(sessionDir, 'latest');
        if (planText) {
          const handoffText = assets.readTextFileSafe(path.join(sessionDir, 'handoff.md'), 256 * 1024);
          const propositionText = assets.readTextFileSafe(path.join(sessionDir, 'proposition.md'), 512 * 1024);
          const verificationGuideText = assets.readTextFileSafe(path.join(sessionDir, 'verification-guide.md'), 512 * 1024);
          const executionStateText = assets.readTextFileSafe(path.join(sessionDir, 'execution-state.json'), 512 * 1024);
          const structured = planState.parseStructuredState(planText, {
            handoffText,
            propositionText,
            verificationGuideText,
            executionStateText,
            sessionId: id,
          });
          compatibilityFinal = formatCompatibilityFinalCloseout(structured);
        }
      }
    } catch {
      compatibilityFinal = null;
    }

    if (compatibilityFinal) {
      sendText(res, 200, compatibilityFinal, 'text/plain; charset=utf-8');
      return;
    }

    if (legacyFinalText != null) {
      sendText(res, 200, legacyFinalText, 'text/plain; charset=utf-8');
      return;
    }

    sendText(res, 404, 'Not found');
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function formatCompatibilityFinalCloseout(structured) {
  const closureSummary = structured && structured.meta && structured.meta.closureSummary
    && typeof structured.meta.closureSummary === 'object'
    ? structured.meta.closureSummary
    : null;
  const executionState = structured && structured.meta && structured.meta.executionState
    && typeof structured.meta.executionState === 'object'
    ? structured.meta.executionState
    : null;
  const terminalExecutionState = isTerminalExecutionState(executionState);

  if (!hasCompatibilityFinalCloseoutEvidence(executionState)) {
    return null;
  }

  const summary = normalizeString(closureSummary && closureSummary.summary)
    || (terminalExecutionState ? normalizeString(executionState && executionState.summary) : '');
  if (!summary) {
    return null;
  }

  const lines = [
    '## Summary',
    `- ${summary}`,
  ];

  const statusItems = [
    closureSummary && closureSummary.outcome ? `Outcome: ${closureSummary.outcome}` : null,
    closureSummary && closureSummary.confidence ? `Confidence: ${closureSummary.confidence}` : null,
    closureSummary && closureSummary.reviewVerdict ? `Review verdict: ${closureSummary.reviewVerdict}` : null,
    executionState && executionState.status ? `Execution status: ${executionState.status}` : null,
  ].filter(Boolean);

  if (statusItems.length > 0) {
    lines.push('', '## Status', ...statusItems.map((item) => `- ${item}`));
  }

  const delivered = closureSummary && Array.isArray(closureSummary.delivered)
    ? closureSummary.delivered.filter((item) => normalizeString(item))
    : [];
  if (delivered.length > 0) {
    lines.push('', '## Delivered', ...delivered.map((item) => `- ${item}`));
  }

  const validationRequirements = closureSummary && Array.isArray(closureSummary.validationRequirements)
    ? closureSummary.validationRequirements.filter((item) => normalizeString(item))
    : [];
  const validationCoverage = closureSummary && Array.isArray(closureSummary.validationCoverage)
    ? closureSummary.validationCoverage.filter((item) => normalizeString(item))
    : [];
  const coverageGaps = closureSummary && Array.isArray(closureSummary.coverageGaps)
    ? closureSummary.coverageGaps.filter((item) => normalizeString(item))
    : [];
  const blockers = closureSummary && Array.isArray(closureSummary.blockers)
    ? closureSummary.blockers.filter((item) => normalizeString(item))
    : [];
  const validationEvidence = closureSummary && Array.isArray(closureSummary.validationEvidence)
    ? closureSummary.validationEvidence.filter((item) => normalizeString(item))
    : [];
  const mandatoryValidationRequirements = validationRequirements.filter((item) => isMandatoryValidationRequirement(item));

  const validationGapItems = [...coverageGaps];
  const requiredValidationLabels = collectCanonicalValidationCloseoutLabels(mandatoryValidationRequirements);
  const coveredValidationLabels = collectCanonicalValidationCloseoutLabels(validationCoverage);
  const validationGapLabels = collectCanonicalValidationCloseoutLabels(coverageGaps);
  const unlabeledMandatoryValidationGaps = mandatoryValidationRequirements
    .filter((item) => !getCanonicalValidationCloseoutLabel(item))
    .map(buildUnresolvedUnlabeledValidationGap);
  for (const item of unlabeledMandatoryValidationGaps) {
    if (!validationGapItems.includes(item)) {
      validationGapItems.push(item);
    }
  }
  const validationBlockers = blockers.filter((item) => isValidationRelatedCloseoutItem(item));
  const validationBlockerLabels = collectCanonicalValidationCloseoutLabels(validationBlockers);
  for (const item of validationBlockers) {
    if (!validationGapItems.includes(item)) {
      validationGapItems.push(item);
    }
  }
  for (const label of requiredValidationLabels) {
    if (
      coveredValidationLabels.has(label)
      || validationGapLabels.has(label)
      || validationBlockerLabels.has(label)
    ) {
      continue;
    }

    const item = buildMissingLabeledValidationGap(label);
    if (!validationGapItems.includes(item)) {
      validationGapItems.push(item);
      validationGapLabels.add(label);
    }
  }
  if (
    mandatoryValidationRequirements.length > 0
    && validationGapItems.length === 0
    && validationCoverage.length === 0
  ) {
    validationGapItems.push('Required validation is still missing from the recorded coverage.');
  }

  if (validationRequirements.length > 0) {
    lines.push('', '## Validation Requirements', ...validationRequirements.map((item) => `- ${item}`));
  }

  if (validationCoverage.length > 0 || mandatoryValidationRequirements.length > 0 || validationGapItems.length > 0) {
    const coverageItems = validationCoverage.length > 0 ? validationCoverage : ['None recorded.'];
    lines.push('', '## Tested Coverage', ...coverageItems.map((item) => `- ${item}`));
  }

  if (validationGapItems.length > 0) {
    lines.push('', '## Coverage Gaps', ...validationGapItems.map((item) => `- ${item}`));
  }

  if (validationEvidence.length > 0) {
    lines.push('', '## Validation Evidence', ...validationEvidence.map((item) => `- ${item}`));
  }

  const activeContinuation = closureSummary
    && closureSummary.followUps
    && Array.isArray(closureSummary.followUps.activeContinuation)
    ? closureSummary.followUps.activeContinuation.filter((item) => normalizeString(item))
    : [];
  if (activeContinuation.length > 0) {
    lines.push('', '## Immediate Next Actions', ...activeContinuation.map((item) => `- ${item}`));
  }

  return `${lines.join('\n')}\n`;
}

function normalizeComparablePath(targetPath, pathLib = path) {
  const normalized = normalizeString(targetPath);
  if (!normalized) {
    return '';
  }
  const resolved = pathLib.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function resolveStructuredSessionRepo(ctx, deps, runtimeSession, startContext) {
  const runtimeRepo = runtimeSession && runtimeSession.orchestration && runtimeSession.orchestration.repo
    ? runtimeSession.orchestration.repo
    : null;
  const selector = {
    repoId: normalizeString(runtimeRepo && runtimeRepo.repoId),
    repoPath: normalizeString(
      (runtimeRepo && runtimeRepo.repoPath)
      || (runtimeSession && runtimeSession.cwd)
      || (startContext && (startContext.cwd || startContext.repo))
    ),
  };

  if (!selector.repoId && !selector.repoPath) {
    return null;
  }

  try {
    const inventory = deps.repoInventory.listKnownRepos({
      elegyHome: ctx.elegyHomeAbs || ctx.elegyHome,
      engineRoot: ctx.engineRoot,
      explicitRepoPaths: selector.repoPath ? [selector.repoPath] : [],
    });
    return deps.repoInventory.resolveRepoEntry(inventory, selector) || null;
  } catch {
    return null;
  }
}

function buildRuntimeActorSummaries(runtimeSession, artifactActors = []) {
  const runtimeActors = Array.isArray(runtimeSession && runtimeSession.orchestration && runtimeSession.orchestration.actors)
    ? runtimeSession.orchestration.actors
    : [];
  const merged = new Map();

  for (const actor of runtimeActors) {
    const normalized = normalizeSessionOrchestrationActor(actor);
    if (normalized) {
      merged.set(normalized.actorId.toLowerCase(), normalized);
    }
  }

  for (const actor of Array.isArray(artifactActors) ? artifactActors : []) {
    const actorId = normalizeString(actor && actor.actorId);
    if (!actorId) {
      continue;
    }
    const key = actorId.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, {
        actorId,
        label: normalizeString(actor.label) || actorId,
        role: normalizeActorRole(actor.role || actor.label || actorId),
        kind: normalizeString(actor.kind) || 'runtime',
        status: normalizeString(actor.status) || null,
        source: normalizeString(actor.source) || 'artifact-events',
        taskId: normalizeString(actor.taskId) || null,
        taskIds: Array.isArray(actor.taskIds) ? actor.taskIds.filter((entry) => normalizeString(entry)) : [],
        invocationCount: Number.isFinite(Number(actor.invocationCount)) ? Number(actor.invocationCount) : null,
      });
      continue;
    }
    const existing = merged.get(key);
    if (!existing.role || existing.role === 'unknown') {
      existing.role = normalizeActorRole(actor.role || actor.label || actorId);
    }
    if (!existing.source) {
      existing.source = normalizeString(actor.source) || 'artifact-events';
    }
    if (!existing.invocationCount && Number.isFinite(Number(actor.invocationCount))) {
      existing.invocationCount = Number(actor.invocationCount);
    }
    const taskIds = Array.isArray(actor.taskIds) ? actor.taskIds : (actor.taskId ? [actor.taskId] : []);
    for (const taskId of taskIds) {
      const normalizedTaskId = normalizeString(taskId);
      if (normalizedTaskId && !existing.taskIds.includes(normalizedTaskId)) {
        existing.taskIds.push(normalizedTaskId);
      }
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.actorId.localeCompare(right.actorId));
}

function collectExecutorWorkflowRuns(deps, sessionId, repoId, taskRecords = []) {
  if (!deps.executorService || typeof deps.executorService.listRuns !== 'function') {
    return [];
  }

  const taskIds = new Set(taskRecords.map((task) => normalizeString(task && task.taskId)).filter(Boolean));
  return deps.executorService.listRuns()
    .filter((run) => {
      if (!run || typeof run !== 'object') return false;
      if (normalizeString(run.sessionId) === sessionId) return true;
      const runTaskRefs = Array.isArray(run.orchestration && run.orchestration.taskRefs)
        ? run.orchestration.taskRefs
        : [];
      const runRepoId = normalizeString(run.repoId);
      if (repoId && runRepoId && runRepoId !== repoId) {
        return false;
      }
      return runTaskRefs.some((entry) => taskIds.has(normalizeString(entry && entry.taskId)));
    })
    .map((run) => ({
      runId: normalizeString(run.id) || null,
      jobId: normalizeString(run.jobId) || null,
      repoId: normalizeString(run.repoId) || null,
      sessionId: normalizeString(run.sessionId) || null,
      status: normalizeString(run.status) || null,
      createdAt: run.createdAt || null,
      updatedAt: run.updatedAt || null,
      startedAt: run.startedAt || null,
      finishedAt: run.finishedAt || null,
      nextRetryAt: run.nextRetryAt || null,
      summary: normalizeString(run.summary) || null,
      error: normalizeString(run.error) || null,
      createdSession: run.createdSession === true,
      workflow: run.orchestration && run.orchestration.workflow ? run.orchestration.workflow : null,
      taskRefs: Array.isArray(run.orchestration && run.orchestration.taskRefs) ? run.orchestration.taskRefs : [],
    }))
    .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''));
}

function collectWorkflowLayerTriggers(deps, sessionId, repoId, taskRecords = []) {
  if (!deps.workflowLayerService || typeof deps.workflowLayerService.listTriggers !== 'function') {
    return [];
  }

  return deps.workflowLayerService.listTriggers({
    sessionId,
    repoId: repoId || null,
    taskIds: taskRecords.map((task) => normalizeString(task && task.taskId)).filter(Boolean),
    limit: 10,
  });
}

function collectOverlaySessions(deps, sessionId, repoId) {
  if (!deps.uiRuntimeOverlayService || typeof deps.uiRuntimeOverlayService.listSessions !== 'function') {
    return [];
  }

  return deps.uiRuntimeOverlayService.listSessions()
    .filter((overlaySession) => {
      if (!overlaySession || typeof overlaySession !== 'object') return false;
      const explicitSessionRefs = new Set([
        normalizeString(overlaySession.linkedSessionId),
        normalizeString(overlaySession.currentSessionId),
        normalizeString(overlaySession.sessionId),
        ...(
          Array.isArray(overlaySession.sessionIds)
            ? overlaySession.sessionIds.map((entry) => normalizeString(entry))
            : []
        ),
        ...(
          Array.isArray(overlaySession.sessionRefs)
            ? overlaySession.sessionRefs.map((entry) => normalizeString(
              entry && typeof entry === 'object'
                ? (entry.sessionId || entry.currentSessionId || entry.id || entry.ref)
                : entry
            ))
            : []
        ),
      ].filter(Boolean));
      return explicitSessionRefs.has(sessionId);
    })
    .map((overlaySession) => ({
      id: overlaySession.id || null,
      status: overlaySession.status || null,
      phase: overlaySession.phase || null,
      runtimeUrl: overlaySession.runtimeUrl || null,
      repoId: overlaySession.repoId || null,
      packageRoot: overlaySession.packageRoot || null,
      linkedSessionId: overlaySession.linkedSessionId || null,
      worktree: overlaySession.worktree || null,
      updatedAt: overlaySession.updatedAt || null,
    }));
}

function buildTaskBoardProjection(sessionId, taskRecords, workflowRuns, worktreeId) {
  const workflowRunIds = new Set(workflowRuns.map((run) => normalizeString(run && run.runId)).filter(Boolean));
  return (Array.isArray(taskRecords) ? taskRecords : [])
    .filter((task) => {
      if (!task || typeof task !== 'object') return false;
      if (normalizeString(task.ownerSessionId) === sessionId) return true;
      if (worktreeId && normalizeString(task.worktree && task.worktree.worktreeId) === worktreeId) return true;
      return workflowRunIds.has(normalizeString(task.workflow && task.workflow.latestRunId));
    })
    .map((task) => ({
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
        ownedBySession: normalizeString(task.ownerSessionId) === sessionId,
      },
    }));
}

function buildSessionOrchestrationState(ctx, deps, id, sessionDir, structured) {
  const runtimeSession = deps.sdkBridge && typeof deps.sdkBridge.getSdkSession === 'function'
    ? deps.sdkBridge.getSdkSession(id)
    : null;
  const startContext = deps.sessions && typeof deps.sessions.getSessionStartContext === 'function'
    ? deps.sessions.getSessionStartContext(sessionDir)
    : null;
  const resolvedRepo = resolveStructuredSessionRepo(ctx, deps, runtimeSession, startContext);
  const runtimeRepo = runtimeSession && runtimeSession.orchestration && runtimeSession.orchestration.repo
    ? runtimeSession.orchestration.repo
    : null;
  const repoId = normalizeString(resolvedRepo && resolvedRepo.repoId) || normalizeString(runtimeRepo && runtimeRepo.repoId);
  const overlaySessions = collectOverlaySessions(deps, id, repoId);
  const directWorkflowRuns = collectExecutorWorkflowRuns(deps, id, repoId, []);
  const scopedWorktreeIds = new Set([
    normalizeString(runtimeSession && runtimeSession.orchestration && runtimeSession.orchestration.isolation && runtimeSession.orchestration.isolation.worktreeId),
    ...overlaySessions
      .filter((overlaySession) => normalizeString(overlaySession && overlaySession.linkedSessionId) === id)
      .map((overlaySession) => normalizeString(overlaySession && overlaySession.worktree && overlaySession.worktree.worktreeId)),
  ].filter(Boolean));
  const repoTasks = repoId && deps.sessions && typeof deps.sessions.listRepoStateTasks === 'function'
    ? deps.sessions.listRepoStateTasks(ctx.elegyHomeAbs || ctx.elegyHome, repoId, {
      sessionId: id,
      workflowRunIds: directWorkflowRuns.map((run) => normalizeString(run && run.runId)).filter(Boolean),
      worktreeIds: Array.from(scopedWorktreeIds),
    })
    : [];
  const artifactActors = deps.sessions && typeof deps.sessions.buildSessionActorSummaries === 'function'
    ? deps.sessions.buildSessionActorSummaries(sessionDir, { taskRecords: repoTasks })
    : [];
  const actors = buildRuntimeActorSummaries(runtimeSession, artifactActors);
  const workflowRuns = collectExecutorWorkflowRuns(deps, id, repoId, repoTasks);
  const currentWorktreeId = normalizeString(
    (runtimeSession && runtimeSession.orchestration && runtimeSession.orchestration.isolation && runtimeSession.orchestration.isolation.worktreeId)
    || (repoTasks.find((task) => task && task.worktree && normalizeString(task.worktree.worktreeId)) || {}).worktree?.worktreeId
    || (overlaySessions.find((overlaySession) => normalizeString(overlaySession && overlaySession.linkedSessionId) === id) || {}).worktree?.worktreeId
  );
  const worktreeMetadata = currentWorktreeId && deps.sessions && typeof deps.sessions.readRepoStateWorktree === 'function'
    ? deps.sessions.readRepoStateWorktree(ctx.elegyHomeAbs || ctx.elegyHome, repoId, currentWorktreeId)
    : null;
  const taskItems = buildTaskBoardProjection(id, repoTasks, workflowRuns, currentWorktreeId);
  const workflowLayerTriggers = collectWorkflowLayerTriggers(deps, id, repoId, repoTasks);
  const runtimeIsolation = runtimeSession && runtimeSession.orchestration && runtimeSession.orchestration.isolation
    ? runtimeSession.orchestration.isolation
    : {};
  const runtimeCwd = normalizeString(runtimeSession && runtimeSession.cwd);
  const repoPath = normalizeString((resolvedRepo && resolvedRepo.repoPath) || (runtimeRepo && runtimeRepo.repoPath));
  const isolationMode = normalizeString(runtimeIsolation.mode)
    || (normalizeString(runtimeSession && runtimeSession.contextType) === 'sandbox'
      ? 'sandbox'
      : (runtimeCwd && repoPath && normalizeComparablePath(runtimeCwd, deps.path) !== normalizeComparablePath(repoPath, deps.path)
        ? 'dedicated'
        : (repoPath ? 'shared' : 'unknown')));

  return buildSessionOrchestrationProjection({
    sessionId: id,
    metadata: {
      objective: deps.sessionArtifacts && typeof deps.sessionArtifacts.deriveSessionObjective === 'function'
        ? deps.sessionArtifacts.deriveSessionObjective({
          intentFrame: structured.meta && structured.meta.intentFrame,
          closureSummary: structured.meta && structured.meta.closureSummary,
          handoff: structured.meta && structured.meta.handoff,
          executionState: structured.meta && structured.meta.executionState,
        })
        : null,
      repo: {
        repoId: repoId || normalizeString(runtimeRepo && runtimeRepo.repoId) || null,
        repoPath: repoPath || runtimeCwd || normalizeString(startContext && startContext.cwd) || null,
        repoLabel: normalizeString(resolvedRepo && resolvedRepo.repoLabel) || repoId || null,
        branch: normalizeString((runtimeRepo && runtimeRepo.branch) || (startContext && startContext.branch)) || null,
        source: runtimeSession ? 'runtime' : (resolvedRepo ? 'catalog' : 'artifact'),
      },
      isolation: {
        mode: isolationMode,
        contextType: normalizeString(runtimeSession && runtimeSession.contextType) || normalizeString(runtimeIsolation.contextType) || null,
        sandboxId: normalizeString(runtimeSession && runtimeSession.sandboxId) || normalizeString(runtimeIsolation.sandboxId) || null,
        worktreeId: currentWorktreeId || null,
        worktreePath: normalizeString((runtimeIsolation && runtimeIsolation.worktreePath) || runtimeCwd || (worktreeMetadata && worktreeMetadata.path)) || null,
        worktreeStatus: normalizeString((runtimeIsolation && runtimeIsolation.worktreeStatus) || (worktreeMetadata && worktreeMetadata.status)) || null,
        launchBlocked: Boolean(
          runtimeIsolation && runtimeIsolation.launchBlocked === true
          || (worktreeMetadata && worktreeMetadata.launch && worktreeMetadata.launch.blocked === true)
        ),
        launchBlockedReason: normalizeString(
          (runtimeIsolation && runtimeIsolation.launchBlockedReason)
          || (worktreeMetadata && worktreeMetadata.launch && worktreeMetadata.launch.reason)
        ) || null,
      },
      actors,
      taskRefs: taskItems.map((task) => ({ taskId: task.taskId, ownerSessionId: task.ownerSessionId, activeActorId: task.activeActorId })),
      workflow: {
        workflowKind: normalizeString((((workflowRuns[0] || {}).workflow) || {}).workflowKind) || 'task-execution',
        trigger: normalizeString((((workflowRuns[0] || {}).workflow) || {}).trigger) || 'manual',
        mode: normalizeString((((workflowRuns[0] || {}).workflow) || {}).mode) || null,
        runId: normalizeString((workflowRuns[0] || {}).runId) || null,
        jobId: normalizeString((workflowRuns[0] || {}).jobId) || null,
        status: normalizeString((workflowRuns[0] || {}).status) || null,
        latestTriggerId: normalizeString((workflowLayerTriggers[0] || {}).triggerId) || null,
        latestTriggerAt: normalizeString((workflowLayerTriggers[0] || {}).capturedAt) || null,
        latestTriggerEventType: normalizeString((workflowLayerTriggers[0] || {}).eventType) || null,
        latestTriggerDeliveryState: normalizeString(
          workflowLayerTriggers[0] && workflowLayerTriggers[0].delivery && workflowLayerTriggers[0].delivery.state
        ) || null,
      },
    },
    actors,
    activeActorId: normalizeString((taskItems.find((task) => task && task.activeActorId) || {}).activeActorId) || null,
    taskItems,
    workflowRuns,
    workflowLayerTriggers,
    overlaySessions,
    worktree: worktreeMetadata || (currentWorktreeId ? { worktreeId: currentWorktreeId } : null),
  });
}

function handleSessionStructuredState(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, readPlanArtifact, planState, assets, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const planId = u.searchParams.get('planId') || 'latest';

  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }

    const planText = readPlanArtifact(sessionDir, planId);
    if (!planText) {
      sendJson(res, 404, { error: 'Plan artifact not found', id, source: home.source, planId });
      return;
    }

    const useLatestSessionArtifacts = planId === 'latest';
    const handoffPath = path.join(sessionDir, 'handoff.md');
    const propositionPath = path.join(sessionDir, 'proposition.md');
    const verificationGuidePath = path.join(sessionDir, 'verification-guide.md');
    const executionStatePath = path.join(sessionDir, 'execution-state.json');
    const handoffText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(handoffPath, 256 * 1024)
      : null;
    const propositionText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(propositionPath, 512 * 1024)
      : null;
    const verificationGuideText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(verificationGuidePath, 512 * 1024)
      : null;
    const executionStateText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(executionStatePath, 512 * 1024)
      : null;
    const structured = planState.parseStructuredState(planText, {
      handoffText,
      propositionText,
      verificationGuideText,
      executionStateText,
      requireHandoff: useLatestSessionArtifacts,
      sessionId: id,
    });
    const orchestration = buildSessionOrchestrationState(ctx, deps, id, sessionDir, structured);
    sendJson(res, 200, {
      id,
      source: home.source,
      planId,
      ...structured,
      orchestration,
    });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionProposition(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, assets, sessionArtifacts, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const propositionPath = path.join(sessionDir, 'proposition.md');

    const text = assets.readTextFileSafe(propositionPath, 512 * 1024);
    if (text == null) {
      sendJson(res, 404, { error: 'Proposition not found', id, source: home.source });
      return;
    }

    sendJson(res, 200, {
      id,
      source: home.source,
      content: text,
      ...sessionArtifacts.parsePropositionText(text),
    });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionHandoff(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, assets, sessionArtifacts, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const handoffPath = path.join(sessionDir, 'handoff.md');

    const text = assets.readTextFileSafe(handoffPath, 256 * 1024);
    if (text == null) {
      sendJson(res, 404, { error: 'Handoff not found', id, source: home.source });
      return;
    }

    sendJson(res, 200, {
      id,
      source: home.source,
      content: text,
      parsed: sessionArtifacts.parseHandoffText(text, { sessionId: id }),
    });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionRoadmapSync(ctx, deps) {
  const { req, res, u, match, elegyHome, sandboxesHome } = ctx;
  const {
    sendJson,
    readJsonBody,
    resolveSessionsHome,
    isValidSessionId,
    readPlanArtifact,
    path,
  } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }

  readJsonBody(req)
    .then((body) => {
      const requestBody = body && typeof body === 'object' ? body : {};
      const selector = normalizeRepoSelector(u.searchParams, requestBody);
      const repo = resolveRepoContext(ctx, deps, selector);

      const source = (u.searchParams.get('source') || requestBody.source || 'cli').toLowerCase();
      const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
      const planId = normalizeString(requestBody.planId || u.searchParams.get('planId')) || 'latest';
      const planText = readPlanArtifact(sessionDir, planId);
      if (!planText) {
        throw Object.assign(new Error('Plan artifact not found'), {
          statusCode: 404,
          code: 'session_plan_not_found',
          reason: 'session_plan_not_found',
        });
      }

      const result = deps.sessionPlanRoadmapSync.syncSessionPlanToRoadmap(
        repo.repoPath,
        id,
        planText,
        {
          planState: deps.planState,
          repositoryBacklogFile: deps.repositoryBacklogFile,
          roadmapArtifacts: deps.roadmapArtifacts,
        },
      );

      sendJson(res, 200, {
        contractVersion: 'planning_api_v1',
        kind: 'sessions.roadmap-sync',
        deterministic: true,
        session: {
          id,
          source: home.source,
          planId,
        },
        repo: {
          repoId: repo.repoId || null,
          repoPath: repo.repoPath || null,
          repoLabel: repo.repoLabel || null,
        },
        ...result,
      });
    })
    .catch((e) => {
      sendJson(res, e.statusCode || 400, {
        contractVersion: 'planning_api_v1',
        kind: 'sessions.roadmap-sync',
        deterministic: true,
        error: String(e.message || e),
        code: normalizeString(e.code) || 'session_roadmap_sync_failed',
        reason: normalizeString(e.reason) || normalizeString(e.code) || 'session_roadmap_sync_failed',
      });
    });
}

function handleSessionContinuationPackage(ctx, deps) {
  const { res, u, match } = ctx;
  const { sendJson, isValidSessionId, readPlanArtifact, planState, assets, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const planId = u.searchParams.get('planId') || 'latest';

  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }

    const planText = readPlanArtifact(sessionDir, planId);
    if (!planText) {
      sendJson(res, 404, { error: 'Plan artifact not found', id, source: home.source, planId });
      return;
    }

    const useLatestSessionArtifacts = planId === 'latest';
    const handoffText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(path.join(sessionDir, 'handoff.md'), 256 * 1024)
      : null;
    const propositionText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(path.join(sessionDir, 'proposition.md'), 512 * 1024)
      : null;
    const verificationGuideText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(path.join(sessionDir, 'verification-guide.md'), 512 * 1024)
      : null;
    const executionStateText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(path.join(sessionDir, 'execution-state.json'), 512 * 1024)
      : null;
    const structuredState = planState.parseStructuredState(planText, {
      handoffText,
      propositionText,
      verificationGuideText,
      executionStateText,
      requireHandoff: useLatestSessionArtifacts,
      sessionId: id,
    });
    const orchestration = buildSessionOrchestrationState(ctx, deps, id, sessionDir, structuredState);
    const transcriptExcerpt = buildTranscriptExcerptFromEvents(
      deps.sessions && typeof deps.sessions.readRecentEvents === 'function'
        ? deps.sessions.readRecentEvents(sessionDir, 120)
        : []
    );
    const continuationPackage = buildSessionContinuationPackage(ctx, deps, {
      sessionId: id,
      source: home.source,
      planText,
      structuredState,
      orchestration,
      transcriptExcerpt,
      targetHarness: u.searchParams.get('targetHarness'),
    });

    sendJson(res, 200, continuationPackage);
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionVerificationGuide(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, assets, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const guidePath = path.join(sessionDir, 'verification-guide.md');

    const text = assets.readTextFileSafe(guidePath, 512 * 1024);
    if (text == null) {
      sendJson(res, 404, { error: 'Verification guide not found', id, source: home.source });
      return;
    }

    sendJson(res, 200, {
      id,
      source: home.source,
      content: text,
    });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionArchive(ctx, deps) {
  const { res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, ensureDir, uniqueArchiveDir, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home } = resolveSessionRequestDir(ctx, deps, id, source);
    const homeAbs = path.resolve(home.home);
    const sessionDir = path.join(homeAbs, 'session-state', id);
    const archiveRoot = path.join(homeAbs, 'sessions-archive');
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }
    ensureDir(archiveRoot);
    const dest = uniqueArchiveDir(archiveRoot, id);
    fs.renameSync(sessionDir, dest);
    sendJson(res, 200, { ok: true, id, source: home.source, archivedTo: dest });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionDelete(ctx, deps) {
  const { req, res, u, match, elegyHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, readJsonBody, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();

  readJsonBody(req)
    .then((body) => {
      const { home } = resolveSessionRequestDir(ctx, deps, id, source);
      const homeAbs = path.resolve(home.home);
      const sessionDir = path.join(homeAbs, 'session-state', id);
      const force = Boolean(body && (body.force || body.confirm));
      if (!force) throw Object.assign(new Error('Deletion requires {"force": true}'), { statusCode: 400 });
      if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
        throw Object.assign(new Error('Session not found'), { statusCode: 404 });
      }

      // Guardrail: never allow deleting outside the configured session-state root.
      const expectedRoot = path.join(homeAbs, 'session-state');
      const resolved = path.resolve(sessionDir);
      const prefix = expectedRoot.endsWith(path.sep) ? expectedRoot : expectedRoot + path.sep;
      if (!resolved.startsWith(prefix)) {
        throw Object.assign(new Error('Refusing to delete path outside session-state'), { statusCode: 400 });
      }

      fs.rmSync(sessionDir, { recursive: true, force: true });
      sendJson(res, 200, { ok: true, id, source: home.source, deleted: true });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source }));
}

function handleUnifiedSessions(ctx, deps) {
  const { res, u, elegyHome, sandboxesHome } = ctx;
  const { sendJson, parseNumberQuery, sessionAggregation } = deps;

  try {
    const all = sessionAggregation.buildUnifiedSessions(elegyHome, { sandboxesHome });

    const projectIdFilter = u.searchParams.get('projectId') || '';
    const statusFilter = u.searchParams.get('status') || '';
    const limit = Math.max(1, Math.min(10000, Math.floor(parseNumberQuery(u.searchParams, 'limit', 100))));

    let result = all;
    if (projectIdFilter) {
      result = result.filter((s) => s.projectId === projectIdFilter);
    }
    if (statusFilter) {
      const normalized = statusFilter.trim().toLowerCase();
      result = result.filter((s) => s.status === normalized);
    }
    result = result.slice(0, limit);

    sendJson(res, 200, result);
  } catch (e) {
    sendJson(res, e.statusCode || 500, { error: String(e.message || e) });
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    crypto: deps.crypto || crypto,
    fs: deps.fs || fs,
    path: deps.path || path,
    sessions: deps.sessions || sessionsLib,
    assets: deps.assets || assetsLib,
    assetInvocationAudit: deps.assetInvocationAudit || assetInvocationAuditLib,
    planState: deps.planState || planStateLib,
    repoInventory: deps.repoInventory || repoInventoryLib,
    roadmapArtifacts: deps.roadmapArtifacts || roadmapArtifactsLib,
    repositoryBacklogFile: deps.repositoryBacklogFile || repositoryBacklogFileLib,
    sessionPlanRoadmapSync: deps.sessionPlanRoadmapSync || sessionPlanRoadmapSyncLib,
    sessionArtifacts: deps.sessionArtifacts || sessionArtifactsLib,
    sessionAggregation: deps.sessionAggregation || sessionAggregationLib,
    continuationPackages: deps.continuationPackages || continuationPackagesLib,
    sdkBridge: deps.sdkBridge || null,
    executorService: deps.executorService || null,
    workflowLayerService: deps.workflowLayerService || null,
    uiRuntimeOverlayService: deps.uiRuntimeOverlayService || null,
    sendJson: deps.sendJson || defaultSendJson,
    sendText: deps.sendText || defaultSendText,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    parseNumberQuery: deps.parseNumberQuery || parseNumberQuery,
    resolveSessionsHome: deps.resolveSessionsHome || resolveSessionsHome,
    isValidSessionId: deps.isValidSessionId || isValidSessionId,
    ensureDir: deps.ensureDir || ensureDir,
    uniqueArchiveDir: deps.uniqueArchiveDir || uniqueArchiveDir,
    listPlanArtifacts: deps.listPlanArtifacts,
    readPlanArtifact: deps.readPlanArtifact,
  };

  return [
    {
      method: 'GET',
      path: '/api/sessions/workspace',
      handler: (ctx) => handleSessionsWorkspace(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/sessions/unified',
      handler: (ctx) => handleUnifiedSessions(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/sessions',
      handler: (ctx) => handleSessionsList(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/events$/,
      handler: (ctx) => handleSessionEvents(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/agent-usage$/,
      handler: (ctx) => handleSessionAgentUsage(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/plan$/,
      handler: (ctx) => handleSessionPlan(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/sessions/plan',
      handler: (ctx) => handleSessionPlanMutation(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/plans$/,
      handler: (ctx) => handleSessionPlans(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/plans\/([^/]+)$/,
      handler: (ctx) => handleSessionPlanById(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/final$/,
      handler: (ctx) => handleSessionFinal(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/structured-state$/,
      handler: (ctx) => handleSessionStructuredState(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/proposition$/,
      handler: (ctx) => handleSessionProposition(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/handoff$/,
      handler: (ctx) => handleSessionHandoff(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/verification-guide$/,
      handler: (ctx) => handleSessionVerificationGuide(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/continuation-package$/,
      handler: (ctx) => handleSessionContinuationPackage(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/sessions\/([^/]+)\/roadmap-sync$/,
      handler: (ctx) => handleSessionRoadmapSync(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/sessions\/([^/]+)\/archive$/,
      handler: (ctx) => handleSessionArchive(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/sessions\/([^/]+)\/delete$/,
      handler: (ctx) => handleSessionDelete(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register, buildSessionsListResponse };
