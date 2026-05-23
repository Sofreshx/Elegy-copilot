'use strict';

const RUNTIME_CONTRACT_VERSION = '1.0.0';

const RUNTIME_MODES = Object.freeze({
  REPO: 'repo',
  PACKAGED: 'packaged',
});

const CAPABILITY_STATES = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

const RUNTIME_PROVIDER_CONTRACT_VERSION = '1';
const RUNTIME_PROVIDERS = Object.freeze({
  NON_DOCKER: 'non-docker',
  DOCKER: 'docker',
});

const RUNTIME_PROVIDER_SELECTION_SOURCES = Object.freeze({
  DEFAULT: 'default',
  EXPLICIT: 'explicit',
});

const SESSION_RECONCILIATION_CONTRACT_VERSION = '1';
const SESSION_RECONCILIATION_SOURCES = Object.freeze({
  RUNTIME: 'runtime',
  ARTIFACT: 'artifact',
});

const SESSION_STATE_AUTHORITIES = Object.freeze({
  RUNTIME: 'acp',
  RUNTIME_ONLY: 'acp',
  ARTIFACT: 'fs',
});

const SESSION_ORCHESTRATION_CONTRACT_VERSION = '1';
const SESSION_ORCHESTRATION_ACTOR_ROLES = Object.freeze([
  'planner',
  'implementer',
  'reviewer',
  'researcher',
  'operator',
  'orchestrator',
  'parent-session',
  'specialist',
  'unknown',
]);

const SESSION_RECONCILIATION_SOURCE_PRECEDENCE = Object.freeze({
  [SESSION_RECONCILIATION_SOURCES.RUNTIME]: 2,
  [SESSION_RECONCILIATION_SOURCES.ARTIFACT]: 1,
});

const SESSION_RECONCILIATION_SOURCE_OF_TRUTH = Object.freeze({
  [SESSION_STATE_AUTHORITIES.RUNTIME]: SESSION_RECONCILIATION_SOURCES.RUNTIME,
  [SESSION_STATE_AUTHORITIES.ARTIFACT]: SESSION_RECONCILIATION_SOURCES.ARTIFACT,
});

const DEFAULT_RUNTIME_MODE = RUNTIME_MODES.REPO;
const DEFAULT_CAPABILITY_STATE = CAPABILITY_STATES.UNKNOWN;
const DEFAULT_RUNTIME_PROVIDER = RUNTIME_PROVIDERS.NON_DOCKER;
const SESSION_ORCHESTRATION_ROLE_SET = new Set(SESSION_ORCHESTRATION_ACTOR_ROLES);

const RUNTIME_COMPATIBILITY_CAPABILITIES = Object.freeze([
  'docker',
  'sandbox',
  'wsl2',
]);

function normalizeRuntimeMode(input) {
  if (typeof input !== 'string') return DEFAULT_RUNTIME_MODE;
  const value = input.trim().toLowerCase();
  if (value === RUNTIME_MODES.REPO) return RUNTIME_MODES.REPO;
  if (value === RUNTIME_MODES.PACKAGED) return RUNTIME_MODES.PACKAGED;
  return DEFAULT_RUNTIME_MODE;
}

function normalizeRuntimeProvider(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === RUNTIME_PROVIDERS.NON_DOCKER || value === 'nondocker') {
    return RUNTIME_PROVIDERS.NON_DOCKER;
  }
  if (value === RUNTIME_PROVIDERS.DOCKER) {
    return RUNTIME_PROVIDERS.DOCKER;
  }
  return null;
}

function normalizeSessionReconciliationSource(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === SESSION_RECONCILIATION_SOURCES.RUNTIME) {
    return SESSION_RECONCILIATION_SOURCES.RUNTIME;
  }
  if (value === SESSION_RECONCILIATION_SOURCES.ARTIFACT || value === 'filesystem') {
    return SESSION_RECONCILIATION_SOURCES.ARTIFACT;
  }
  return null;
}

function getSessionReconciliationSourcePrecedence(input) {
  const normalized = normalizeSessionReconciliationSource(input);
  return normalized ? SESSION_RECONCILIATION_SOURCE_PRECEDENCE[normalized] || 0 : 0;
}

function hasStatePresence(explicitPresence, stateValue) {
  if (explicitPresence === true) return true;
  if (explicitPresence === false) return false;
  return stateValue !== null && stateValue !== undefined;
}

function resolveSessionReconciliationAuthority(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const hasRuntimeState = hasStatePresence(source.hasRuntimeState, source.runtimeState);
  const hasArtifactState = hasStatePresence(source.hasArtifactState, source.artifactState);

  const authority = hasRuntimeState
    ? SESSION_STATE_AUTHORITIES.RUNTIME
    : SESSION_STATE_AUTHORITIES.ARTIFACT;

  const sourcePrecedence = [];
  if (hasRuntimeState) {
    sourcePrecedence.push(SESSION_RECONCILIATION_SOURCES.RUNTIME);
  }
  if (hasArtifactState) {
    sourcePrecedence.push(SESSION_RECONCILIATION_SOURCES.ARTIFACT);
  }
  if (!sourcePrecedence.length) {
    sourcePrecedence.push(SESSION_RECONCILIATION_SOURCES.ARTIFACT);
  }

  sourcePrecedence.sort((a, b) => {
    const precedenceDiff = getSessionReconciliationSourcePrecedence(b) - getSessionReconciliationSourcePrecedence(a);
    if (precedenceDiff !== 0) {
      return precedenceDiff;
    }
    return a.localeCompare(b);
  });

  return {
    contractVersion: SESSION_RECONCILIATION_CONTRACT_VERSION,
    deterministic: true,
    authority,
    sourceOfTruth: SESSION_RECONCILIATION_SOURCE_OF_TRUTH[authority],
    sourcePrecedence,
    hasRuntimeState,
    hasArtifactState,
  };
}

function buildRuntimeProviderMetadata(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const defaultProvider = normalizeRuntimeProvider(source.defaultProvider) || DEFAULT_RUNTIME_PROVIDER;
  const explicitSelection = normalizeRuntimeProvider(source.selectedProvider);

  return {
    contractVersion: RUNTIME_PROVIDER_CONTRACT_VERSION,
    selectedProvider: explicitSelection || defaultProvider,
    defaultProvider,
    selectionSource: explicitSelection
      ? RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT
      : RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT,
  };
}

function normalizeCapabilityState(input) {
  if (typeof input !== 'string') return DEFAULT_CAPABILITY_STATE;
  const value = input.trim().toLowerCase();
  if (value === CAPABILITY_STATES.AVAILABLE) return CAPABILITY_STATES.AVAILABLE;
  if (value === CAPABILITY_STATES.UNAVAILABLE) return CAPABILITY_STATES.UNAVAILABLE;
  if (value === CAPABILITY_STATES.UNKNOWN) return CAPABILITY_STATES.UNKNOWN;
  return DEFAULT_CAPABILITY_STATE;
}

function normalizeCapabilities(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const normalized = {};
  const keys = Object.keys(input).sort((a, b) => a.localeCompare(b));

  for (const key of keys) {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) continue;
    normalized[normalizedKey] = normalizeCapabilityState(input[key]);
  }

  return normalized;
}

function detectRuntimeMode(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  if (typeof source.explicitMode === 'string' && source.explicitMode.trim()) {
    return normalizeRuntimeMode(source.explicitMode);
  }

  if (source.isPackaged === true) {
    return RUNTIME_MODES.PACKAGED;
  }

  const engineRoot = typeof source.engineRoot === 'string' ? source.engineRoot.toLowerCase() : '';
  if (engineRoot.includes('app.asar')) {
    return RUNTIME_MODES.PACKAGED;
  }

  return DEFAULT_RUNTIME_MODE;
}

function buildCompatibilityCapabilities(input) {
  const normalized = normalizeCapabilities(input);
  const merged = {};

  for (const capability of RUNTIME_COMPATIBILITY_CAPABILITIES) {
    merged[capability] = Object.prototype.hasOwnProperty.call(normalized, capability)
      ? normalized[capability]
      : DEFAULT_CAPABILITY_STATE;
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) continue;
    merged[key] = value;
  }

  return normalizeCapabilities(merged);
}

function normalizeOptionalString(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return value || null;
}

function cloneJsonSafe(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeActorRole(input) {
  const value = normalizeOptionalString(input);
  if (!value) {
    return 'unknown';
  }

  const normalized = value.toLowerCase().replace(/[_\s]+/g, '-');
  if (SESSION_ORCHESTRATION_ROLE_SET.has(normalized)) {
    return normalized;
  }
  if (normalized.includes('plan')) return 'planner';
  if (normalized.includes('implement') || normalized.includes('coder') || normalized.includes('builder')) return 'implementer';
  if (normalized.includes('review') || normalized.includes('qa') || normalized.includes('verify')) return 'reviewer';
  if (normalized.includes('research') || normalized.includes('discover')) return 'researcher';
  if (normalized.includes('orchestr')) return 'orchestrator';
  if (normalized.includes('operator') || normalized.includes('user')) return 'operator';
  return 'specialist';
}

function normalizeSessionOrchestrationActor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const actorId = normalizeOptionalString(
    input.actorId
    || input.id
    || input.label
    || input.name
  );
  const label = normalizeOptionalString(input.label || input.name || input.actorId || input.id);

  if (!actorId && !label) {
    return null;
  }

  return {
    actorId: actorId || label,
    label: label || actorId,
    role: normalizeActorRole(input.role || input.kind || input.label || input.name),
    kind: normalizeOptionalString(input.kind) || 'runtime',
    status: normalizeOptionalString(input.status),
    source: normalizeOptionalString(input.source) || 'runtime',
    taskId: normalizeOptionalString(input.taskId),
    taskIds: Array.isArray(input.taskIds)
      ? input.taskIds.map((value) => normalizeOptionalString(value)).filter(Boolean)
      : [],
    invocationCount: Number.isFinite(Number(input.invocationCount)) ? Number(input.invocationCount) : null,
  };
}

function normalizeSessionOrchestrationMetadata(input = {}, defaults = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fallback = defaults && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : {};

  const repoSource = source.repo && typeof source.repo === 'object' ? source.repo : {};
  const isolationSource = source.isolation && typeof source.isolation === 'object' ? source.isolation : {};
  const workflowSource = source.workflow && typeof source.workflow === 'object' ? source.workflow : {};
  const taskRefs = Array.isArray(source.taskRefs)
    ? source.taskRefs
    : Array.isArray(source.tasks)
      ? source.tasks
      : [];
  const actors = Array.isArray(source.actors) ? source.actors : [];

  return {
    objective: normalizeOptionalString(source.objective || fallback.objective),
    repo: {
      repoId: normalizeOptionalString(repoSource.repoId || repoSource.id || fallback.repoId),
      repoPath: normalizeOptionalString(repoSource.repoPath || repoSource.path || fallback.repoPath),
      repoLabel: normalizeOptionalString(repoSource.repoLabel || repoSource.label || fallback.repoLabel),
      branch: normalizeOptionalString(repoSource.branch || fallback.branch),
      source: normalizeOptionalString(repoSource.source || fallback.repoSource) || null,
    },
     isolation: {
       mode: normalizeOptionalString(isolationSource.mode || fallback.isolationMode) || null,
       contextType: normalizeOptionalString(isolationSource.contextType || fallback.contextType) || null,
       sandboxId: normalizeOptionalString(isolationSource.sandboxId || fallback.sandboxId),
       worktreeId: normalizeOptionalString(isolationSource.worktreeId || fallback.worktreeId),
       worktreePath: normalizeOptionalString(isolationSource.worktreePath || fallback.worktreePath),
       worktreeStatus: normalizeOptionalString(
         isolationSource.worktreeStatus
         || (isolationSource.worktree && isolationSource.worktree.status)
         || fallback.worktreeStatus
       ),
       launchBlocked: isolationSource.launchBlocked === true || fallback.launchBlocked === true,
       launchBlockedReason: normalizeOptionalString(
         isolationSource.launchBlockedReason
         || (isolationSource.worktree && isolationSource.worktree.launch && isolationSource.worktree.launch.reason)
         || fallback.launchBlockedReason
       ),
     },
    actors: actors.map((actor) => normalizeSessionOrchestrationActor(actor)).filter(Boolean),
    taskRefs: taskRefs
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          const taskId = normalizeOptionalString(entry);
          return taskId ? { taskId } : null;
        }
        const taskId = normalizeOptionalString(entry.taskId || entry.id);
        if (!taskId) return null;
        return {
          taskId,
          title: normalizeOptionalString(entry.title),
          status: normalizeOptionalString(entry.status),
          ownerSessionId: normalizeOptionalString(entry.ownerSessionId),
          activeActorId: normalizeOptionalString(entry.activeActorId),
          activeActorLabel: normalizeOptionalString(entry.activeActorLabel),
        };
      })
      .filter(Boolean),
    workflow: {
      workflowKind: normalizeOptionalString(workflowSource.workflowKind || workflowSource.kind || fallback.workflowKind),
      workflowId: normalizeOptionalString(workflowSource.workflowId || workflowSource.id || fallback.workflowId),
      trigger: normalizeOptionalString(workflowSource.trigger || fallback.trigger),
      mode: normalizeOptionalString(workflowSource.mode || fallback.workflowMode),
      runId: normalizeOptionalString(workflowSource.runId || fallback.runId),
      jobId: normalizeOptionalString(workflowSource.jobId || fallback.jobId),
      sessionId: normalizeOptionalString(workflowSource.sessionId || fallback.sessionId),
      status: normalizeOptionalString(workflowSource.status || fallback.workflowStatus),
    },
  };
}

function buildSessionOrchestrationProjection(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const metadata = normalizeSessionOrchestrationMetadata(source.metadata || source, source.defaults || {});
  const actors = Array.isArray(source.actors)
    ? source.actors.map((actor) => normalizeSessionOrchestrationActor(actor)).filter(Boolean)
    : metadata.actors;
  const taskItems = Array.isArray(source.taskItems) ? source.taskItems.map((item) => cloneJsonSafe(item)).filter(Boolean) : [];
  const workflowRuns = Array.isArray(source.workflowRuns) ? source.workflowRuns.map((item) => cloneJsonSafe(item)).filter(Boolean) : [];
  const overlaySessions = Array.isArray(source.overlaySessions) ? source.overlaySessions.map((item) => cloneJsonSafe(item)).filter(Boolean) : [];
  const worktree = source.worktree && typeof source.worktree === 'object'
    ? cloneJsonSafe(source.worktree)
    : null;

  return {
    contractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
    sessionId: normalizeOptionalString(source.sessionId),
    objective: metadata.objective,
    authority: {
      liveSession: SESSION_STATE_AUTHORITIES.RUNTIME,
      artifactFallback: SESSION_STATE_AUTHORITIES.ARTIFACT,
      durableTasks: 'repo-state',
      workflowRuns: 'executor',
      worktrees: 'repo-state',
      overlays: 'runtime',
    },
    repo: metadata.repo,
    isolation: {
      ...metadata.isolation,
      worktree,
    },
    actors: {
      items: actors,
      activeActorId: normalizeOptionalString(source.activeActorId)
        || normalizeOptionalString((taskItems.find((item) => item && item.activeActorId) || {}).activeActorId),
    },
    taskBoard: {
      durableStore: 'repo-state',
      repoId: metadata.repo.repoId,
      items: taskItems,
    },
    workflow: {
      ...metadata.workflow,
      runs: workflowRuns,
    },
    overlays: {
      sessions: overlaySessions,
    },
  };
}

function buildRuntimeContract(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  return {
    contractVersion: RUNTIME_CONTRACT_VERSION,
    mode: normalizeRuntimeMode(source.mode),
    capabilities: normalizeCapabilities(source.capabilities),
    provider: buildRuntimeProviderMetadata({
      selectedProvider: source.selectedProvider,
      defaultProvider: source.defaultProvider,
    }),
  };
}

function buildCompatibilityRuntimeContract(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  return {
    contractVersion: RUNTIME_CONTRACT_VERSION,
    mode: detectRuntimeMode({
      explicitMode: source.mode,
      isPackaged: source.isPackaged,
      engineRoot: source.engineRoot,
    }),
    capabilities: buildCompatibilityCapabilities(source.capabilities),
    provider: buildRuntimeProviderMetadata({
      selectedProvider: source.selectedProvider,
      defaultProvider: source.defaultProvider,
    }),
  };
}

module.exports = {
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_MODES,
  CAPABILITY_STATES,
  RUNTIME_PROVIDER_CONTRACT_VERSION,
  RUNTIME_PROVIDERS,
  RUNTIME_PROVIDER_SELECTION_SOURCES,
  SESSION_RECONCILIATION_CONTRACT_VERSION,
  SESSION_RECONCILIATION_SOURCES,
  SESSION_RECONCILIATION_SOURCE_PRECEDENCE,
  SESSION_RECONCILIATION_SOURCE_OF_TRUTH,
  SESSION_STATE_AUTHORITIES,
  SESSION_ORCHESTRATION_CONTRACT_VERSION,
  SESSION_ORCHESTRATION_ACTOR_ROLES,
  RUNTIME_COMPATIBILITY_CAPABILITIES,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_CAPABILITY_STATE,
  DEFAULT_RUNTIME_PROVIDER,
  normalizeRuntimeMode,
  normalizeRuntimeProvider,
  normalizeSessionReconciliationSource,
  getSessionReconciliationSourcePrecedence,
  normalizeCapabilityState,
  normalizeCapabilities,
  detectRuntimeMode,
  buildRuntimeProviderMetadata,
  resolveSessionReconciliationAuthority,
  buildCompatibilityCapabilities,
  buildRuntimeContract,
  buildCompatibilityRuntimeContract,
  normalizeActorRole,
  normalizeSessionOrchestrationActor,
  normalizeSessionOrchestrationMetadata,
  buildSessionOrchestrationProjection,
};
