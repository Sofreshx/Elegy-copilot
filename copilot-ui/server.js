#!/usr/bin/env node
/* eslint-disable no-console */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

/**
 * @typedef {import('@elegy-copilot/contracts').WorkflowStep} ContractWorkflowStep
 * @typedef {import('@elegy-copilot/contracts').WorkflowDefinition} ContractWorkflowDefinition
 * @typedef {import('@elegy-copilot/contracts').WorkflowRunResult} ContractWorkflowRunResult
 * @typedef {import('@elegy-copilot/contracts').PlanningRecord} ContractPlanningRecord
 * @typedef {import('@elegy-copilot/contracts').WorkflowPlanningBridge} ContractWorkflowPlanningBridge
 * @typedef {import('@elegy-copilot/contracts').ExecutorPolicyRequest} ContractExecutorPolicyRequest
 * @typedef {import('@elegy-copilot/contracts').ExecutorPolicyResponse} ContractExecutorPolicyResponse
 */

const sessions = require('./lib/sessions');
const repoInventoryService = require('./lib/repoInventoryService');
const assets = require('./lib/assets');
const planState = require('./lib/planState');
const { createAutonomousDecisionLog } = require('./lib/autonomousDecisionLog');
const {
  SESSION_RECONCILIATION_CONTRACT_VERSION,
  SESSION_RECONCILIATION_SOURCES,
  SESSION_RECONCILIATION_SOURCE_PRECEDENCE,
  SESSION_RECONCILIATION_SOURCE_OF_TRUTH,
  SESSION_STATE_AUTHORITIES,
} = require('./lib/runtimeContracts');
const {
  buildPlanningScopeIsolationPredicate,
  deriveNextPlanningRecordNumber,
  deriveBackfillRecoveryMarker,
  deriveBackfillSourceIdempotencyKey,
  buildPlanningProviderStatePersistencePayload,
  evaluatePlanningOptimisticConcurrencyGuard,
  listPersistedPlanningRecords,
  persistPlanningRecord,
  persistPlanningCompareReceipt,
  readPlanningCompareReceipt,
  persistPlanningMergeIntent,
  readPlanningMergeIntent,
  consumePlanningMergeIntent,
  resetPlanningMergeIntentConsumption,
  persistPlanningSuggestion,
  readPlanningSuggestion,
  persistPlanningRecap,
  readPlanningRecap,
  persistRoadmapWorkflowArtifact,
  readRoadmapWorkflowArtifact,
  listRoadmapWorkflowArtifacts,
  readPlanningMergeIdempotencyRecord,
  persistPlanningMergeIdempotencyRecord,
  deletePlanningMergeIdempotencyRecord,
  deletePersistedPlanningRecordById,
  runPlanningRetention,
  exportPlanningPersistenceSnapshot,
  importPlanningPersistenceSnapshot,
  scanPlanningPersistenceCorruption,
  readPlanningPersistenceConfig,
  readPlanningProviderState,
  reconcileBackfillItemStatusTransition,
  validatePlanningPersistenceConfig,
  validatePlanningReadWriteContext,
  getPlanningPersistenceHealth,
  runPlanningMigrations,
  PLANNING_WS5A_DURABILITY_REQUIRED_MIGRATION_VERSIONS,
} = require('./lib/planningPersistence');
const {
  SEMANTIC_SCORING_CONTRACT_VERSION,
  scorePlanningCandidate,
  sortPlanningCandidates,
  determineSemanticDegradedMode,
  classifyEmbeddingLifecycle,
  evaluateSemanticGate,
} = require('./lib/planningSemantic');
const {
  PLANNING_API_CONTRACT_VERSION,
  buildPlanningPersistenceHealthEnvelope,
  buildFinishCompatibilityHookContract,
  evaluateProviderLifecycleCapability,
  buildLifecycleUnsupportedCapabilityMarker,
  createPlanningApiState,
  replacePlanningProjectionFromPersistedRecords,
  createPlanningRecordOperation,
  listPlanningRecordsOperation,
  searchPlanningRecordsOperation,
  comparePlanningRecordsOperation,
  buildPlanningRouteLockKey,
  acquirePlanningRouteLock,
  releasePlanningRouteLock,
  evictPlanningIdempotencyEntry,
} = require('./lib/planningApiContracts');
const { createPostgresPlanningPersistenceClient } = require('./lib/planningPersistenceClient');
const { createDesktopUpdaterController } = require('./lib/desktop-shell/updater');
const { createRegistry } = require('./routes');
const { createExecutorService } = require('./lib/executorService');
const { createWorkflowLayerService } = require('./lib/workflowLayerService');
const { createUiRuntimeOverlayService } = require('./lib/uiRuntimeOverlayService');
const {
  isNonLoopback,
  checkAuth,
  resolveToken,
  derivePlanningActorId,
} = require('./lib/server/auth');
const {
  resolveCopilotHome,
  resolveVscodeHome,
  resolveSandboxesHome,
  resolveMessagingGatewayConfigPath,
  resolveSessionsHome,
} = require('./lib/server/paths');
const { createRuntimeHealthResolver } = require('./lib/server/runtimeHealth');
const { createRoadmapWorkflowMemoryBridge } = require('./lib/roadmapWorkflowMemoryBridge');
const { createRoadmapWorkflowPlanningBridge } = require('./lib/roadmapWorkflowPlanningBridge');
const { resolveElegyPlanningCliPath, downloadElegyPlanningCli } = require('./lib/elegyPlanningCliResolver');
const {
  resolveTrackerUrl,
  resolveTrackerToken,
  createLifecycleCompatibilityRequestHeaders,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
  buildLifecycleMixedVersionUnsupportedMarker,
  evaluateLifecycleMixedVersionCompatibility,
  buildGatewayProbeFailure,
  probeTrackerReadiness,
  buildGatewayStateEnvelope,
  shouldRemapTrackerMissingTokenPayload,
  buildTrackerProxyPassThroughHeaders,
  buildTrackerProxyResponsePlan,
} = require('./lib/server/trackerIntegration');

const copilotUiPackageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const DEFAULT_DESKTOP_ROLLBACK_POLICY_FILE_NAME = 'default-desktop-rollback-policy.json';
const DEFAULT_DESKTOP_ROLLBACK_POLICY_RUNTIME_DIRECTORY = 'runtime-manifests';
const DEFAULT_DESKTOP_ROLLBACK_POLICY_WORKSPACE_DIRECTORY = path.join('resources', 'runtime-manifests');

const WS3_AUTHORITY_DEPENDENCY_GATE_CONTRACT_VERSION = '1';
const WS3_AUTHORITY_DEPENDENCY_NAME = 'ws3_authority_reconciliation_contract';
const WS3_AUTHORITY_DEPENDENCY_BLOCK_CODE = 'planning_durability_dependency_gate_blocked';
const WS5A_DURABILITY_ROUTE_GATE_CONTRACT_VERSION = '1';
const WS5A_DURABILITY_ROUTE_GATE_NAME = 'ws5a_durability_persistence_gate';
const WS5A_DURABILITY_ROUTE_BLOCK_CODE = 'planning_durability_route_gate_blocked';
const WS5A_DURABILITY_CRITICAL_ROUTES = Object.freeze(new Set([
  '/api/planning/compare',
  '/api/planning/merge-intent',
  '/api/planning/merge',
  '/api/planning/suggestions',
  '/api/planning/recaps',
]));
const getRuntimeHealth = createRuntimeHealthResolver();

function readDefaultDesktopRollbackPolicy(engineRoot, logger = () => {}) {
  const resolvedEngineRoot = path.resolve(engineRoot || path.resolve(__dirname, '..'));
  const candidatePaths = [
    path.join(resolvedEngineRoot, DEFAULT_DESKTOP_ROLLBACK_POLICY_RUNTIME_DIRECTORY, DEFAULT_DESKTOP_ROLLBACK_POLICY_FILE_NAME),
    path.join(resolvedEngineRoot, 'copilot-ui', DEFAULT_DESKTOP_ROLLBACK_POLICY_WORKSPACE_DIRECTORY, DEFAULT_DESKTOP_ROLLBACK_POLICY_FILE_NAME),
    path.join(resolvedEngineRoot, DEFAULT_DESKTOP_ROLLBACK_POLICY_WORKSPACE_DIRECTORY, DEFAULT_DESKTOP_ROLLBACK_POLICY_FILE_NAME),
    path.join(__dirname, DEFAULT_DESKTOP_ROLLBACK_POLICY_WORKSPACE_DIRECTORY, DEFAULT_DESKTOP_ROLLBACK_POLICY_FILE_NAME),
  ];

  for (const policyPath of candidatePaths) {
    try {
      if (!fs.existsSync(policyPath)) {
        continue;
      }

      const raw = fs.readFileSync(policyPath, 'utf8').trim();
      if (raw) {
        return raw;
      }
    } catch (error) {
      logger(`[desktop-updater] unable to read bundled rollback policy ${policyPath}: ${String(error && error.message ? error.message : error)}`);
    }
  }

  return null;
}

function createChangeTracker(copilotHomeAbs, vscodeHomeAbs, sandboxesHomeAbs) {
  let version = 0;
  let lastChangedMs = Date.now();
  let timer = null;
  const watchers = [];

  function bump() {
    version += 1;
    lastChangedMs = Date.now();
  }

  function scheduleBump() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(bump, 150);
  }

  function tryWatch(dirAbs, opts = {}) {
    try {
      if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return;
      const recursive = Boolean(opts.recursive);
      const w = fs.watch(dirAbs, { persistent: false, recursive }, () => scheduleBump());
      watchers.push(w);
    } catch {
      // best-effort
    }
  }

  // Watch the primary folders users care about.
  // Also watch the Copilot home root so newly created folders (agents/skills) trigger updates.
  tryWatch(copilotHomeAbs);
  tryWatch(path.join(copilotHomeAbs, 'session-state'), { recursive: true });
  tryWatch(path.join(copilotHomeAbs, 'agents'));
  tryWatch(path.join(copilotHomeAbs, 'skills'));
  tryWatch(path.join(copilotHomeAbs, 'prompts'));

  // VS Code session store (separate root)
  if (vscodeHomeAbs) {
    tryWatch(vscodeHomeAbs);
    tryWatch(path.join(vscodeHomeAbs, 'session-state'), { recursive: true });
    tryWatch(path.join(vscodeHomeAbs, 'sessions-archive'), { recursive: true });
    // VS Code installed assets (non-recursive watch; best-effort)
    tryWatch(path.join(vscodeHomeAbs, 'agents'));
    tryWatch(path.join(vscodeHomeAbs, 'skills'));
    tryWatch(path.join(vscodeHomeAbs, 'prompts'));
  }

  // Watch sandbox directories.
  if (sandboxesHomeAbs) {
    tryWatch(sandboxesHomeAbs, { recursive: true });
  }

  // Periodic bump as a fallback: ensures UI stays roughly current even if fs.watch is flaky.
  const interval = setInterval(() => bump(), 60 * 1000);

  return {
    get() {
      return { version, lastChangedMs };
    },
    close() {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
    },
  };
}

function getUniqueManagedAssetHomes(homes) {
  const uniqueHomes = [];
  const seen = new Set();

  for (const home of Array.isArray(homes) ? homes : []) {
    if (typeof home !== 'string' || !home.trim()) {
      continue;
    }

    const resolvedHome = path.resolve(home.trim());
    const key = process.platform === 'win32' ? resolvedHome.toLowerCase() : resolvedHome;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueHomes.push(resolvedHome);
  }

  return uniqueHomes;
}

function runStartupManagedAssetSync(engineRoot, homes, options = {}) {
  const quiet = options.quiet === true;
  const force = options.force === true;
  const summaries = [];

  for (const home of getUniqueManagedAssetHomes(homes)) {
    try {
      const result = assets.syncManagedInstall(engineRoot, home, {
        force,
        pointerMode: options.pointerMode !== false,
      });
      const summary = {
        home,
        syncedCount: Array.isArray(result.synced) ? result.synced.length : 0,
        prunedCount: Array.isArray(result.prunedPaths) ? result.prunedPaths.length : 0,
      };
      summaries.push(summary);

      if (!quiet && (summary.syncedCount > 0 || summary.prunedCount > 0)) {
        console.log(`[startup-sync] ${home}: synced ${summary.syncedCount}, pruned ${summary.prunedCount}`);
      }
    } catch (error) {
      const detail = String(error && error.message ? error.message : error);
      summaries.push({
        home,
        syncedCount: 0,
        prunedCount: 0,
        error: detail,
      });

      if (!quiet) {
        console.warn(`[startup-sync] ${home}: ${detail}`);
      }
    }
  }

  return summaries;
}

function formatManagedAssetSyncCount(label, count) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function summarizeStartupManagedAssetSync(managedAssetSyncSummary, options = {}) {
  const summaries = Array.isArray(managedAssetSyncSummary) ? managedAssetSyncSummary : [];
  const ran = options.ran === true;
  const lastRunAt = typeof options.lastRunAt === 'string' && options.lastRunAt.trim()
    ? options.lastRunAt.trim()
    : new Date().toISOString();
  const syncedCount = summaries.reduce((total, entry) => total + (Number.isFinite(entry && entry.syncedCount) ? Number(entry.syncedCount) : 0), 0);
  const prunedCount = summaries.reduce((total, entry) => total + (Number.isFinite(entry && entry.prunedCount) ? Number(entry.prunedCount) : 0), 0);
  const errorCount = summaries.reduce((total, entry) => total + (entry && entry.error ? 1 : 0), 0);
  const homeCount = summaries.length;

  let status = 'healthy';
  let outcome = 'succeeded';
  let message = 'Startup managed-asset sync completed with no changes.';

  if (!ran) {
    status = 'warning';
    outcome = 'skipped';
    message = 'Startup managed-asset sync was skipped for this launch.';
  } else if (errorCount > 0 && errorCount === homeCount && syncedCount === 0 && prunedCount === 0) {
    status = 'degraded';
    outcome = 'failed';
    message = `Startup managed-asset sync failed for ${formatManagedAssetSyncCount('home', homeCount)}.`;
  } else if (errorCount > 0) {
    status = 'warning';
    outcome = 'partial';
    message = [
      `Startup managed-asset sync completed with warnings for ${formatManagedAssetSyncCount('home', homeCount)}.`,
      formatManagedAssetSyncCount('asset synced', syncedCount),
      formatManagedAssetSyncCount('path pruned', prunedCount),
      formatManagedAssetSyncCount('error', errorCount),
    ].join(' ');
  } else if (syncedCount > 0 || prunedCount > 0) {
    message = [
      `Startup managed-asset sync completed for ${formatManagedAssetSyncCount('home', homeCount)}.`,
      formatManagedAssetSyncCount('asset synced', syncedCount),
      formatManagedAssetSyncCount('path pruned', prunedCount),
    ].join(' ');
  } else if (homeCount > 0) {
    message = `Startup managed-asset sync completed with no changes for ${formatManagedAssetSyncCount('home', homeCount)}.`;
  }

  return {
    status,
    outcome,
    ran,
    lastRunAt,
    homeCount,
    syncedCount,
    prunedCount,
    errorCount,
    message,
    homes: summaries.map((entry) => ({
      home: entry.home,
      syncedCount: Number.isFinite(entry.syncedCount) ? Number(entry.syncedCount) : 0,
      prunedCount: Number.isFinite(entry.prunedCount) ? Number(entry.prunedCount) : 0,
      ...(entry.error ? { error: String(entry.error) } : {}),
    })),
    decisionLogged: false,
    decisionEventId: null,
    decisionLoggedAt: null,
    decisionLogError: null,
  };
}

function buildStartupManagedAssetSyncDecisionEvent(startupManagedAssetSync) {
  return {
    kind: 'startup.managed_asset_sync',
    source: 'copilot-ui.server',
    outcome: startupManagedAssetSync.outcome,
    summary: startupManagedAssetSync.message,
    details: {
      ran: startupManagedAssetSync.ran,
      homeCount: startupManagedAssetSync.homeCount,
      syncedCount: startupManagedAssetSync.syncedCount,
      prunedCount: startupManagedAssetSync.prunedCount,
      errorCount: startupManagedAssetSync.errorCount,
      homes: startupManagedAssetSync.homes,
    },
  };
}

function parseArgs(argv) {
  const args = { port: 3210, host: '127.0.0.1', token: null, copilotHome: null, vscodeHome: null, sandboxesHome: null, trackerUrl: null, trackerToken: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a === '--port') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --port: ${v}`);
      args.port = Math.floor(n);
      continue;
    }
    if (a.startsWith('--port=')) {
      const v = a.slice('--port='.length);
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --port: ${v}`);
      args.port = Math.floor(n);
      continue;
    }
    if (a === '--copilot-home') {
      args.copilotHome = argv[++i];
      if (!args.copilotHome) throw new Error('Missing value for --copilot-home');
      continue;
    }
    if (a.startsWith('--copilot-home=')) {
      args.copilotHome = a.slice('--copilot-home='.length);
      if (!args.copilotHome) throw new Error('Missing value for --copilot-home');
      continue;
    }
    if (a === '--vscode-home') {
      args.vscodeHome = argv[++i];
      if (!args.vscodeHome) throw new Error('Missing value for --vscode-home');
      continue;
    }
    if (a.startsWith('--vscode-home=')) {
      args.vscodeHome = a.slice('--vscode-home='.length);
      if (!args.vscodeHome) throw new Error('Missing value for --vscode-home');
      continue;
    }
    if (a === '--host') {
      args.host = argv[++i];
      if (!args.host) throw new Error('Missing value for --host');
      continue;
    }
    if (a.startsWith('--host=')) {
      args.host = a.slice('--host='.length);
      if (!args.host) throw new Error('Missing value for --host');
      continue;
    }
    if (a === '--token') {
      args.token = argv[++i];
      if (!args.token) throw new Error('Missing value for --token');
      continue;
    }
    if (a.startsWith('--token=')) {
      args.token = a.slice('--token='.length);
      if (!args.token) throw new Error('Missing value for --token');
      continue;
    }
    if (a === '--sandboxes-home') {
      args.sandboxesHome = argv[++i];
      if (!args.sandboxesHome) throw new Error('Missing value for --sandboxes-home');
      continue;
    }
    if (a.startsWith('--sandboxes-home=')) {
      args.sandboxesHome = a.slice('--sandboxes-home='.length);
      if (!args.sandboxesHome) throw new Error('Missing value for --sandboxes-home');
      continue;
    }
    if (a === '--tracker-url') {
      args.trackerUrl = argv[++i];
      if (!args.trackerUrl) throw new Error('Missing value for --tracker-url');
      continue;
    }
    if (a.startsWith('--tracker-url=')) {
      args.trackerUrl = a.slice('--tracker-url='.length);
      if (!args.trackerUrl) throw new Error('Missing value for --tracker-url');
      continue;
    }
    if (a === '--tracker-token') {
      args.trackerToken = argv[++i];
      if (!args.trackerToken) throw new Error('Missing value for --tracker-token');
      continue;
    }
    if (a.startsWith('--tracker-token=')) {
      args.trackerToken = a.slice('--tracker-token='.length);
      if (!args.trackerToken) throw new Error('Missing value for --tracker-token');
      continue;
    }
  }
  return args;
}

function isValidSessionId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
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

function safeResolveUnder(baseAbs, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) throw new Error('path must be a non-empty string');
  if (path.isAbsolute(relPath)) throw new Error('path must be relative');
  const base = path.resolve(baseAbs);
  const abs = path.resolve(base, relPath);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!abs.startsWith(prefix)) throw new Error('path escapes base');
  return abs;
}

function extractTriggers(absPath) {
  try {
    const text = fs.readFileSync(absPath, 'utf8');
    const match = text.match(/Triggers?\s+on:\s*(.+)/i);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text || '');
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400, cause: e }));
      }
    });
    req.on('error', reject);
  });
}

async function initializePlanningPersistenceAuthority(planningPersistenceConfig, planningPersistenceState) {
  const authority = resolvePlanningPersistenceAuthorityState(planningPersistenceConfig, planningPersistenceState);

  if (!authority.persistedAuthority) {
    const required = Boolean(authority.validation && authority.validation.required);
    if (!required) {
      return {
        statusCode: 200,
        body: {
          contractVersion: PLANNING_API_CONTRACT_VERSION,
          kind: 'planning.persistence.init',
          deterministic: true,
          ready: true,
          initialized: true,
          result: {
            mode: 'noop_optional_persistence',
          },
          errors: [],
          planningPersistence: buildPlanningPersistenceHealthEnvelope(
            getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
          ),
          corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
        },
      };
    }

    return {
      statusCode: 503,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.persistence.init',
        deterministic: true,
        ready: false,
        initialized: false,
        error: {
          code: 'planning_persistence_not_configured',
          reason: 'planning_persistence_not_configured',
          message: 'Planning persistence is not configured',
        },
        errors: [{
          code: 'planning_persistence_not_configured',
          reason: 'planning_persistence_not_configured',
          message: 'Planning persistence is not configured',
        }],
        planningPersistence: buildPlanningPersistenceHealthEnvelope(
          getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
        ),
        corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
      },
    };
  }

  if (!authority.client) {
    planningPersistenceState.status = 'configured_no_client';
    planningPersistenceState.lastError = authority.lastError || 'planning_persistence_client_unavailable';

    return {
      statusCode: 503,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.persistence.init',
        deterministic: true,
        ready: false,
        initialized: false,
        error: {
          code: 'planning_persistence_client_unavailable',
          reason: 'planning_persistence_client_unavailable',
          message: 'Planning persistence client is unavailable',
        },
        errors: [{
          code: 'planning_persistence_client_unavailable',
          reason: 'planning_persistence_client_unavailable',
          message: 'Planning persistence client is unavailable',
        }],
        planningPersistence: buildPlanningPersistenceHealthEnvelope(
          getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
        ),
        corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
      },
    };
  }

  try {
    const migrationResult = await runPlanningMigrations(authority.client, {
      schemaTable: planningPersistenceConfig && planningPersistenceConfig.schemaTable,
    });

    planningPersistenceState.status = 'ready';
    planningPersistenceState.lastError = null;
    planningPersistenceState.client = authority.client;
    planningPersistenceState.migrations = {
      ...migrationResult,
      lastRunAt: new Date().toISOString(),
    };
    const corruptionScan = await scanPlanningPersistenceCorruption(authority.client);
    const corruption = applyPlanningPersistenceCorruptionScan(planningPersistenceState, corruptionScan);

    return {
      statusCode: 200,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.persistence.init',
        deterministic: true,
        ready: true,
        initialized: true,
        writeBlocked: corruption.blocked,
        errors: [],
        result: {
          appliedCount: migrationResult.appliedCount,
          appliedVersions: migrationResult.appliedVersions,
          driftDetected: migrationResult.driftDetected,
          schemaTable: migrationResult.schemaTable,
          corruptionScan,
        },
        planningPersistence: buildPlanningPersistenceHealthEnvelope(
          getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
        ),
        corruption,
      },
    };
  } catch (error) {
    const isChecksumDrift = error && error.code === 'PLANNING_MIGRATION_CHECKSUM_DRIFT';
    const isBaselineMismatch = error && error.code === 'PLANNING_MIGRATION_BASELINE_MISMATCH';

    const code = isBaselineMismatch
      ? 'planning_persistence_checksum_baseline_mismatch'
      : isChecksumDrift
        ? 'planning_persistence_checksum_drift'
        : 'planning_persistence_init_failed';
    const reason = code;
    const status = isChecksumDrift || isBaselineMismatch
      ? 'drift_detected'
      : 'migration_error';

    planningPersistenceState.status = status;
    planningPersistenceState.lastError = String(error && error.message ? error.message : error);
    planningPersistenceState.client = authority.client;
    planningPersistenceState.migrations = {
      ...(planningPersistenceState.migrations && typeof planningPersistenceState.migrations === 'object'
        ? planningPersistenceState.migrations
        : {}),
      driftDetected: isChecksumDrift || isBaselineMismatch,
      baselineMismatch: isBaselineMismatch,
      checksumValidation: error && error.checksumValidation
        ? error.checksumValidation
        : null,
      lastRunAt: new Date().toISOString(),
    };

    return {
      statusCode: 503,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.persistence.init',
        deterministic: true,
        ready: false,
        initialized: false,
        error: {
          code,
          reason,
          message: String(error && error.message ? error.message : error),
        },
        errors: [{
          code,
          reason,
          message: String(error && error.message ? error.message : error),
        }],
        planningPersistence: buildPlanningPersistenceHealthEnvelope(
          getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState),
        ),
        corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
      },
    };
  }
}

const OPEN_TERMINAL_ALLOWED_LAUNCHERS = new Set(['auto', 'pwsh', 'terminal', 'x-terminal-emulator']);
const OPEN_TERMINAL_ALLOWED_PROFILES = new Set(['default']);
const FINISH_PR_ACTIONS = new Set(['skip-pr', 'open-pr', 'open-pr:canceled']);
const SHELL_META_CHAR_RE = /[;&|`<>]/;
const SHELL_EXPANSION_RE = /(\$\(|\$\{|\$[A-Za-z_][A-Za-z0-9_]*|%[^%\r\n\s]+%|![^!\r\n\s]+!)/;
const SANDBOX_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;

function containsUnsafeShellSyntax(input) {
  const value = String(input || '');
  return SHELL_META_CHAR_RE.test(value) || SHELL_EXPANSION_RE.test(value);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(key) {
  return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isForbiddenEnvKey(key) {
  const normalized = normalizeKey(key);
  return normalized === 'env'
    || normalized === 'environment'
    || normalized === 'processenv'
    || normalized === 'shellenv'
    || normalized === 'environmentvariables';
}

function findForbiddenEnvPath(value, prefix = '') {
  if (!isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (isForbiddenEnvKey(key)) return next;
    const nested = findForbiddenEnvPath(child, next);
    if (nested) return nested;
  }
  return null;
}

function validateOpenTerminalLifecyclePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'payload_not_object' } };
  }

  const forbiddenEnvPath = findForbiddenEnvPath(payload);
  if (forbiddenEnvPath) {
    return { ok: false, error: { code: 'env_injection_denied', reason: `forbidden_field:${forbiddenEnvPath}` } };
  }

  for (const key of Object.keys(payload)) {
    if (key !== 'sandboxId' && key !== 'launcher' && key !== 'profile') {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: `unexpected_field:${key}` } };
    }
  }

  if (typeof payload.sandboxId !== 'string' || !payload.sandboxId.trim()) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'missing_or_invalid_sandbox_id' } };
  }
  const sandboxId = payload.sandboxId.trim();
  if (containsUnsafeShellSyntax(sandboxId)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:sandboxId' } };
  }
  if (!SANDBOX_ID_RE.test(sandboxId)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_sandbox_id_format' } };
  }

  let launcher;
  if (payload.launcher !== undefined) {
    if (typeof payload.launcher !== 'string' || !payload.launcher.trim()) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_launcher' } };
    }
    launcher = payload.launcher.trim();
    if (containsUnsafeShellSyntax(launcher)) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:launcher' } };
    }
    if (!OPEN_TERMINAL_ALLOWED_LAUNCHERS.has(launcher)) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_launcher' } };
    }
  }

  let profile;
  if (payload.profile !== undefined) {
    if (typeof payload.profile !== 'string' || !payload.profile.trim()) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_profile' } };
    }
    profile = payload.profile.trim();
    if (containsUnsafeShellSyntax(profile)) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:profile' } };
    }
    if (!OPEN_TERMINAL_ALLOWED_PROFILES.has(profile)) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_profile' } };
    }
  }

  return {
    ok: true,
    value: {
      sandboxId,
      ...(launcher ? { launcher } : {}),
      ...(profile ? { profile } : {}),
    },
  };
}

function validateLifecycleBranchToken(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    return {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: `missing_or_invalid_${fieldName}`,
      },
    };
  }

  const branch = value.trim();
  if (containsUnsafeShellSyntax(branch)) {
    return {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: `unsafe_shell_syntax:${fieldName}`,
      },
    };
  }

  if (!BRANCH_NAME_RE.test(branch)) {
    return {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: `invalid_${fieldName}_format`,
      },
    };
  }

  return {
    ok: true,
    value: branch,
  };
}

function validateFinishLifecyclePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'payload_not_object' } };
  }

  const forbiddenEnvPath = findForbiddenEnvPath(payload);
  if (forbiddenEnvPath) {
    return { ok: false, error: { code: 'env_injection_denied', reason: `forbidden_field:${forbiddenEnvPath}` } };
  }

  for (const key of Object.keys(payload)) {
    if (key !== 'sandboxId' && key !== 'prAction' && key !== 'baseBranch' && key !== 'headBranch') {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: `unexpected_field:${key}` } };
    }
  }

  if (typeof payload.sandboxId !== 'string' || !payload.sandboxId.trim()) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'missing_or_invalid_sandbox_id' } };
  }

  const sandboxId = payload.sandboxId.trim();
  if (containsUnsafeShellSyntax(sandboxId)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:sandboxId' } };
  }
  if (!SANDBOX_ID_RE.test(sandboxId)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_sandbox_id_format' } };
  }

  const prActionToken = payload.prAction === undefined || payload.prAction === null
    ? 'skip-pr'
    : String(payload.prAction).trim();

  if (!FINISH_PR_ACTIONS.has(prActionToken)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_finish_pr_action' } };
  }

  if (prActionToken !== 'open-pr' && (payload.baseBranch !== undefined || payload.headBranch !== undefined)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'pr_branches_require_open_pr_action' } };
  }

  if (prActionToken === 'open-pr') {
    const baseBranch = validateLifecycleBranchToken(payload.baseBranch, 'baseBranch');
    if (!baseBranch.ok) return baseBranch;

    const headBranch = validateLifecycleBranchToken(payload.headBranch, 'headBranch');
    if (!headBranch.ok) return headBranch;

    return {
      ok: true,
      value: {
        sandboxId,
        prAction: prActionToken,
        baseBranch: baseBranch.value,
        headBranch: headBranch.value,
      },
    };
  }

  return {
    ok: true,
    value: {
      sandboxId,
      prAction: prActionToken,
    },
  };
}

function collectFinishResponseSandboxObservations(body) {
  if (!isPlainObject(body)) return [];

  const observations = [];
  const seen = new Set();

  const appendObservation = (pathToken, value) => {
    if (typeof value !== 'string') return;
    const sandboxId = value.trim();
    if (!sandboxId) return;
    const dedupeKey = `${pathToken}:${sandboxId}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    observations.push({ path: pathToken, sandboxId });
  };

  appendObservation('sandboxId', body.sandboxId);

  const result = isPlainObject(body.result) ? body.result : null;
  if (result) {
    appendObservation('result.sandboxId', result.sandboxId);
    const close = isPlainObject(result.close) ? result.close : null;
    const closeResult = close && isPlainObject(close.result) ? close.result : null;
    if (closeResult) {
      appendObservation('result.close.result.sandboxId', closeResult.sandboxId);
    }
  }

  const close = isPlainObject(body.close) ? body.close : null;
  const closeResult = close && isPlainObject(close.result) ? close.result : null;
  if (closeResult) {
    appendObservation('close.result.sandboxId', closeResult.sandboxId);
  }

  return observations;
}

function buildLifecycleInvariantViolationBody({ expectedSandboxId, observed, prAction, providerState }) {
  const migration = providerState && isPlainObject(providerState.migration)
    ? providerState.migration
    : {};
  const migrationReasonCodes = normalizeDeterministicReasonCodes(
    Array.isArray(migration.reasonCodes) ? migration.reasonCodes : []
  );
  const reasonCodes = normalizeDeterministicReasonCodes([
    'canonical_sandbox_id_mismatch',
    'canonical_sandbox_id_persisted_invariant',
    prAction === 'open-pr' ? 'finish_pr_open_path' : 'finish_pr_skip_path',
    migration.required ? 'provider_state_migration_present' : '',
    ...migrationReasonCodes,
  ]);

  return {
    error: 'Lifecycle canonical sandboxId invariant violated',
    code: 'canonical_sandbox_id_invariant_violation',
    action: 'finish',
    reason: 'canonical_sandbox_id_mismatch',
    deterministic: true,
    invariant: {
      marker: 'conflict',
      scope: 'cross_ws_canonical_id',
      expectedSandboxId,
      receivedSandboxId: observed.sandboxId,
      receivedPath: observed.path,
      reasonCodes,
      providerState: {
        selectedProvider: providerState && typeof providerState.selectedProvider === 'string'
          ? providerState.selectedProvider
          : null,
        defaultProvider: providerState && typeof providerState.defaultProvider === 'string'
          ? providerState.defaultProvider
          : null,
        migration: {
          required: Boolean(migration.required),
          reasonCodes: migrationReasonCodes,
        },
      },
    },
  };
}

function validateFinishCanonicalSandboxIdInvariant({ canonicalSandboxId, prAction, trackerBody, providerState }) {
  if (typeof canonicalSandboxId !== 'string' || !canonicalSandboxId.trim()) {
    return {
      ok: false,
      statusCode: 409,
      body: {
        error: 'Lifecycle canonical sandboxId invariant violated',
        code: 'canonical_sandbox_id_invariant_violation',
        action: 'finish',
        reason: 'missing_canonical_sandbox_id',
        deterministic: true,
        invariant: {
          marker: 'conflict',
          scope: 'cross_ws_canonical_id',
          expectedSandboxId: null,
          receivedSandboxId: null,
          receivedPath: null,
          reasonCodes: ['missing_canonical_sandbox_id'],
        },
      },
    };
  }

  const expectedSandboxId = canonicalSandboxId.trim();
  const observations = collectFinishResponseSandboxObservations(trackerBody);
  for (const observation of observations) {
    if (observation.sandboxId !== expectedSandboxId) {
      return {
        ok: false,
        statusCode: 409,
        body: buildLifecycleInvariantViolationBody({
          expectedSandboxId,
          observed: observation,
          prAction,
          providerState,
        }),
      };
    }
  }

  return { ok: true };
}

function normalizeScopeList(scopes) {
  if (!Array.isArray(scopes)) return [];
  const out = [];
  const seen = new Set();
  for (const scope of scopes) {
    const normalized = planState.normalizePlanningScope(scope);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeIdentity(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized ? normalized.toLowerCase() : '';
}

function canReadPlanningRecord(record, context = {}) {
  if (!record || typeof record !== 'object') return false;

  const scope = planState.normalizePlanningScope(record);
  const userId = normalizeIdentity(context.userId);
  const repoId = normalizeIdentity(context.repoId);

  if (!scope || !userId) return false;

  const ownerId = normalizeIdentity(record.ownerId);
  const recordRepoId = normalizeIdentity(record.repoId);

  if (scope === 'repo') {
    return Boolean(ownerId && recordRepoId && ownerId === userId && repoId && recordRepoId === repoId);
  }

  if (scope === 'global' || scope === 'user') {
    return Boolean(ownerId && ownerId === userId);
  }

  return false;
}

function canWritePlanningRecord(record, context = {}) {
  return canReadPlanningRecord(record, context);
}

function filterPlanningRecordsForCompare(records, context = {}) {
  const requestedScopes = normalizeScopeList(context.requestedScopes);
  const result = { records: [], deniedScopes: [] };

  if (!requestedScopes.length) {
    return result;
  }

  const userId = normalizeIdentity(context.userId);
  const repoId = normalizeIdentity(context.repoId);

  const allowedScopes = new Set();
  for (const scope of requestedScopes) {
    if (!userId) {
      result.deniedScopes.push(scope);
      continue;
    }
    if (scope === 'repo') {
      if (!repoId) {
        result.deniedScopes.push(scope);
        continue;
      }
      allowedScopes.add(scope);
      continue;
    }
    if (scope === 'global' || scope === 'user') {
      allowedScopes.add(scope);
      continue;
    }
    result.deniedScopes.push(scope);
  }

  if (!Array.isArray(records) || !records.length) {
    result.deniedScopes = [...new Set(result.deniedScopes)].sort();
    return result;
  }

  for (const record of records) {
    const scope = planState.normalizePlanningScope(record);
    if (!scope || !allowedScopes.has(scope)) continue;
    if (canReadPlanningRecord(record, context)) {
      result.records.push(record);
    }
  }

  result.deniedScopes = [...new Set(result.deniedScopes)].sort();
  return result;
}

function firstStringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim()) {
          return entry.trim();
        }
      }
    }
  }
  return '';
}

function parsePlanningScopesFromRequest(u, body = null) {
  if (body && Array.isArray(body.scopes)) {
    return body.scopes;
  }

  const scopesParam = u.searchParams.get('scopes');
  if (typeof scopesParam === 'string' && scopesParam.trim()) {
    return scopesParam.split(',').map((scope) => scope.trim()).filter(Boolean);
  }

  const repeated = u.searchParams.getAll('scope');
  if (repeated && repeated.length) {
    return repeated;
  }

  return [];
}

function buildPlanningRequestContext(req, u, body = null, authContext = {}) {
  const userId = normalizeIdentity(authContext.userId);
  const repoId = normalizeIdentity(firstStringValue(
    body && body.repoId,
    req.headers['x-planning-repo-id'],
    u.searchParams.get('repoId'),
  ));

  return { userId, repoId };
}

function resolveRequestIdempotencyKey(req, body = null) {
  return firstStringValue(
    body && body.idempotencyKey,
    req.headers['idempotency-key'],
  );
}

function normalizeIfMatchToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';

  const weakPrefix = /^W\//i;
  const withoutWeakPrefix = weakPrefix.test(token) ? token.replace(weakPrefix, '') : token;
  const unquoted = withoutWeakPrefix.replace(/^"|"$/g, '').trim();
  return unquoted;
}

function resolveExpectedPlanningVersion(req, payload = null) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const rawIfMatch = firstStringValue(req && req.headers && req.headers['if-match']);

  return firstStringValue(
    body.expectedVersion,
    body.expectedRecordsVersion,
    body.version,
    body.versionVector && body.versionVector.planningRecordsVersion,
    body.versionVector && body.versionVector.pinned && body.versionVector.pinned.planningRecordsVersion,
    req && req.headers && req.headers['x-planning-records-version'],
    normalizeIfMatchToken(rawIfMatch),
  );
}

function evaluatePlanningRouteOptimisticConcurrency(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const expectedVersion = source.expectedVersion;

  if (expectedVersion == null || String(expectedVersion).trim() === '') {
    return {
      ok: true,
      skipped: true,
    };
  }

  const guard = evaluatePlanningOptimisticConcurrencyGuard({
    resourceType: 'planning_records_projection',
    resourceId: source.resourceId || 'planning_records',
    expectedVersion,
    actualVersion: source.actualVersion,
  });

  if (guard.ok) {
    return {
      ok: true,
      skipped: false,
      guard,
    };
  }

  return {
    ok: false,
    skipped: false,
    guard,
    statusCode: 409,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: resolvePlanningDurabilityGateKind(source.pathname, source.method),
      deterministic: true,
      error: 'Planning optimistic concurrency conflict',
      code: guard.code,
      reason: guard.reason,
      optimisticConcurrency: guard.result,
      versionVector: {
        expected: String(expectedVersion).trim(),
        current: String(source.actualVersion == null ? '' : source.actualVersion).trim() || null,
      },
    },
  };
}

function acquirePlanningMutationRouteLock(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const context = source.context && typeof source.context === 'object' ? source.context : {};
  const ownerPrefix = firstStringValue(
    source.ownerId,
    source.requestId,
    source.idempotencyKey,
  ) || 'request';
  const lockOwner = `${ownerPrefix}:${crypto.randomUUID()}`;

  const routeKind = resolvePlanningDurabilityGateKind(source.pathname, source.method);
  const lockKey = buildPlanningRouteLockKey({
    routeKind,
    actorId: context.userId,
    repoId: context.repoId,
  });

  const lock = acquirePlanningRouteLock(source.planningApiState, {
    routeKind,
    actorId: context.userId,
    repoId: context.repoId,
    ownerId: lockOwner,
    nowMs: source.nowMs,
  });

  if (lock.ok) {
    return {
      ok: true,
      lock,
    };
  }

  return {
    ok: false,
    statusCode: 409,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: routeKind,
      deterministic: true,
      error: 'Planning route lock conflict',
      code: lock.code || 'planning_route_lock_conflict',
      reason: lock.reason || 'lock_already_held',
      lock: {
        lockKey,
        ...(lock.lock || {}),
      },
    },
  };
}

function resolvePlanningPersistenceAuthorityState(planningPersistenceConfig, planningPersistenceState) {
  const state = planningPersistenceState && typeof planningPersistenceState === 'object'
    ? planningPersistenceState
    : {};
  const validation = state.validation || validatePlanningPersistenceConfig(planningPersistenceConfig || {});
  const client = state.client && typeof state.client.query === 'function'
    ? state.client
    : null;

  const persistedAuthority = Boolean(validation.usable);
  const ready = persistedAuthority && Boolean(client) && String(state.status || '') === 'ready';

  return {
    persistedAuthority,
    ready,
    client,
    status: String(state.status || ''),
    validation,
    lastError: String(state.lastError || '').trim() || null,
  };
}

function resolvePlanningLiveAuthorityState(roadmapWorkflowPlanningBridge) {
  if (!roadmapWorkflowPlanningBridge || typeof roadmapWorkflowPlanningBridge !== 'object') {
    return {
      ready: false,
      enabled: false,
      configured: false,
      status: 'missing',
      error: {
        code: 'planning_live_authority_bridge_missing',
        reason: 'planning_live_authority_bridge_missing',
        message: 'elegy-planning authority bridge is unavailable.',
        statusCode: 503,
      },
    };
  }

  const status = typeof roadmapWorkflowPlanningBridge.getStatus === 'function'
    ? roadmapWorkflowPlanningBridge.getStatus()
    : null;
  if (status && typeof status === 'object') {
    const code = String(status.code || '').trim();
    return {
      ...status,
      status: String(status.status || (status.ready === true ? 'ready' : 'unavailable')).trim() || 'unknown',
      error: status.ready === true
        ? null
        : {
            code: code || 'planning_live_authority_unavailable',
            reason: code || 'planning_live_authority_unavailable',
            message: String(status.message || 'elegy-planning authority is unavailable.').trim(),
            statusCode: 503,
          },
    };
  }

  return {
    ready: false,
    enabled: true,
    configured: false,
    status: 'unknown',
    error: {
      code: 'planning_live_authority_unknown',
      reason: 'planning_live_authority_unknown',
      message: 'elegy-planning authority status is unavailable.',
      statusCode: 503,
    },
  };
}

function buildRetiredRepoFilePlanningSurfaceResponse(kind, surfaceLabel) {
  const label = typeof surfaceLabel === 'string' && surfaceLabel.trim()
    ? surfaceLabel.trim()
    : 'Repo-file planning surface';

  return {
    contractVersion: PLANNING_API_CONTRACT_VERSION,
    kind,
    deterministic: true,
    error: `${label} is retired. Use Planning task board, live planning, and workflow artifact surfaces instead.`,
    code: 'planning_repo_file_authority_retired',
    reason: 'planning_repo_file_authority_retired',
  };
}

function resolveRetiredRepoFilePlanningSurface(pathname, method) {
  const route = String(pathname || '').trim();
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();
  const isReadMethod = normalizedMethod === 'GET' || normalizedMethod === 'HEAD';

  if (route === '/api/planning/roadmaps') {
    return isReadMethod
      ? { kind: 'planning.roadmaps.list', surfaceLabel: 'planning roadmaps' }
      : null;
  }

  if (/^\/api\/planning\/roadmaps\/[^/]+\/reconcile$/i.test(route)) {
    return normalizedMethod === 'POST'
      ? { kind: 'planning.roadmaps.reconcile', surfaceLabel: 'planning roadmaps' }
      : null;
  }

  if (/^\/api\/planning\/roadmaps\/[^/]+$/i.test(route)) {
    return isReadMethod
      ? { kind: 'planning.roadmaps.read', surfaceLabel: 'planning roadmaps' }
      : null;
  }

  if (route === '/api/planning/backlog' || route.startsWith('/api/planning/backlog/')) {
    return {
      kind: isReadMethod ? 'planning.backlog.read' : 'planning.backlog.write',
      surfaceLabel: 'planning backlog',
    };
  }

  if (
    route === '/api/planning/artifacts/bullets'
    || route.startsWith('/api/planning/artifacts/bullets/')
    || route === '/api/planning/artifacts/intake'
    || route.startsWith('/api/planning/artifacts/intake/')
  ) {
    return {
      kind: isReadMethod ? 'planning.artifacts.read' : 'planning.artifacts.create',
      surfaceLabel: 'planning artifacts',
    };
  }

  return null;
}

function buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState) {
  const state = planningPersistenceState && typeof planningPersistenceState === 'object'
    ? planningPersistenceState
    : {};
  const corruption = state.corruption && typeof state.corruption === 'object'
    ? state.corruption
    : {};

  const scannedAt = typeof corruption.scannedAt === 'string' && corruption.scannedAt.trim()
    ? corruption.scannedAt.trim()
    : null;
  const blocked = corruption.blocked === true;

  return {
    contractVersion: '1',
    scannedAt,
    blocked,
    recoveryRequired: corruption.recoveryRequired === true || blocked,
    findingCount: Number.isFinite(corruption.findingCount)
      ? Math.max(0, Math.floor(Number(corruption.findingCount)))
      : 0,
    code: String(corruption.code || '').trim()
      || (blocked ? 'planning_persistence_corruption_detected' : 'planning_persistence_corruption_not_scanned'),
    reason: String(corruption.reason || '').trim()
      || (blocked ? 'corruption_detected' : 'corruption_scan_not_run'),
  };
}

function applyPlanningPersistenceCorruptionScan(planningPersistenceState, scanResult = {}) {
  const state = planningPersistenceState && typeof planningPersistenceState === 'object'
    ? planningPersistenceState
    : null;
  if (!state) {
    return buildPlanningPersistenceCorruptionEnvelope({ corruption: scanResult });
  }

  const scannedAt = String(scanResult.scannedAt || '').trim() || new Date().toISOString();
  const blocked = scanResult.blocked === true;

  state.corruption = {
    contractVersion: '1',
    scannedAt,
    blocked,
    recoveryRequired: scanResult.recoveryRequired === true || blocked,
    findingCount: Number.isFinite(scanResult.findingCount)
      ? Math.max(0, Math.floor(Number(scanResult.findingCount)))
      : 0,
    code: String(scanResult.code || '').trim()
      || (blocked ? 'planning_persistence_corruption_detected' : 'planning_persistence_corruption_clear'),
    reason: String(scanResult.reason || '').trim()
      || (blocked ? 'corruption_detected' : 'no_corruption_detected'),
  };

  if (blocked) {
    state.lastError = 'planning_persistence_corruption_detected';
  } else if (state.lastError === 'planning_persistence_corruption_detected') {
    state.lastError = null;
  }

  return buildPlanningPersistenceCorruptionEnvelope(state);
}

function buildPlanningPersistenceOperationAuthorityFailure(pathname, method, planningPersistenceConfig, planningPersistenceState, authority) {
  if (!authority.persistedAuthority) {
    return buildPlanningPersistenceFailure(pathname, method, {
      statusCode: 503,
      code: 'planning_persistence_not_configured',
      error: 'Planning persistence is not configured',
      reason: 'planning_persistence_not_configured',
      configured: authority.validation.configured,
      usable: authority.validation.usable,
      required: authority.validation.required,
      ready: authority.ready,
      status: authority.status,
      governance: getPlanningPersistenceHealth(
        planningPersistenceConfig,
        planningPersistenceState,
      ).governance,
      corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
    });
  }

  if (!authority.ready) {
    const reasonCode = resolveWs5aPersistenceAuthorityReasonCode(authority, planningPersistenceState);
    return buildPlanningPersistenceFailure(pathname, method, {
      statusCode: 503,
      code: 'planning_persistence_unavailable',
      error: 'Planning persistence unavailable',
      reason: reasonCode,
      configured: authority.validation.configured,
      usable: authority.validation.usable,
      required: authority.validation.required,
      ready: authority.ready,
      status: authority.status,
      governance: getPlanningPersistenceHealth(
        planningPersistenceConfig,
        planningPersistenceState,
      ).governance,
      corruption: buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState),
    });
  }

  return null;
}

function resolvePlanningPersistenceOperationClient(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const authority = resolvePlanningPersistenceAuthorityState(
    source.planningPersistenceConfig,
    source.planningPersistenceState,
  );

  const failure = buildPlanningPersistenceOperationAuthorityFailure(
    source.pathname,
    source.method,
    source.planningPersistenceConfig,
    source.planningPersistenceState,
    authority,
  );

  if (failure) {
    return {
      ok: false,
      authority,
      failure,
    };
  }

  return {
    ok: true,
    authority,
  };
}

function buildPlanningPersistenceWriteBlockedFailure(pathname, method, planningPersistenceConfig, planningPersistenceState, authority) {
  const corruption = buildPlanningPersistenceCorruptionEnvelope(planningPersistenceState);
  if (!corruption.blocked) return null;

  return buildPlanningPersistenceFailure(pathname, method, {
    statusCode: 503,
    code: 'planning_persistence_recovery_required',
    error: 'Planning persistence write blocked pending recovery',
    reason: corruption.reason || 'corruption_detected',
    configured: authority.validation.configured,
    usable: authority.validation.usable,
    required: authority.validation.required,
    ready: authority.ready,
    status: authority.status,
    governance: getPlanningPersistenceHealth(
      planningPersistenceConfig,
      planningPersistenceState,
    ).governance,
    corruption,
  });
}

function buildPlanningPersistenceFailure(pathname, method, input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const reason = String(source.reason || '').trim() || 'planning_persistence_unavailable';
  const code = String(source.code || '').trim() || 'planning_persistence_unavailable';
  const statusCode = Number.isFinite(source.statusCode) ? Number(source.statusCode) : 503;

  return {
    statusCode,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: resolvePlanningDurabilityGateKind(pathname, method),
      deterministic: true,
      error: String(source.error || 'Planning persistence unavailable'),
      code,
      reason,
      planningPersistence: {
        authority: 'db',
        configured: Boolean(source.configured),
        usable: Boolean(source.usable),
        required: Boolean(source.required),
        ready: Boolean(source.ready),
        status: String(source.status || '').trim() || null,
        governance: source.governance && typeof source.governance === 'object'
          ? source.governance
          : null,
        corruption: source.corruption && typeof source.corruption === 'object'
          ? source.corruption
          : null,
      },
    },
  };
}

async function hydratePlanningProjectionFromPersistence(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const authority = resolvePlanningPersistenceAuthorityState(
    source.planningPersistenceConfig,
    source.planningPersistenceState,
  );

  if (!authority.persistedAuthority) {
    return {
      ok: true,
      persistedAuthority: false,
      ready: false,
      client: null,
    };
  }

  if (!authority.ready) {
    const reasonCode = resolveWs5aPersistenceAuthorityReasonCode(authority, source.planningPersistenceState);
    return {
      ok: false,
      failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
        statusCode: 503,
        code: 'planning_persistence_unavailable',
        error: 'Planning persistence unavailable',
        reason: reasonCode,
        configured: authority.validation.configured,
        usable: authority.validation.usable,
        required: authority.validation.required,
        ready: authority.ready,
        status: authority.status,
        governance: getPlanningPersistenceHealth(
          source.planningPersistenceConfig,
          source.planningPersistenceState,
        ).governance,
      }),
    };
  }

  const context = source.context && typeof source.context === 'object' ? source.context : {};
  if (!normalizeIdentity(context.userId)) {
    return {
      ok: true,
      persistedAuthority: true,
      ready: true,
      client: authority.client,
    };
  }

  try {
    const projection = await listPersistedPlanningRecords(authority.client, {
      actorId: context.userId,
      repoId: context.repoId,
      scopes: source.scopes,
    });

    if (!projection.ok) {
      const reason = projection.error && projection.error.reason
        ? projection.error.reason
        : 'planning_persistence_read_denied';
      const code = projection.error && projection.error.code
        ? projection.error.code
        : 'planning_persistence_read_failed';

      return {
        ok: false,
        failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
          statusCode: code === 'scope_visibility_denied' ? 403 : 503,
          code,
          error: 'Planning persistence read failed',
          reason,
          configured: authority.validation.configured,
          usable: authority.validation.usable,
          required: authority.validation.required,
          ready: authority.ready,
          status: authority.status,
          governance: getPlanningPersistenceHealth(
            source.planningPersistenceConfig,
            source.planningPersistenceState,
          ).governance,
        }),
      };
    }

    replacePlanningProjectionFromPersistedRecords(source.planningApiState, {
      records: projection.records,
      nextRecordNumber: deriveNextPlanningRecordNumber(projection.records),
    });

    return {
      ok: true,
      persistedAuthority: true,
      ready: true,
      client: authority.client,
      projection,
    };
  } catch (error) {
    return {
      ok: false,
      failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
        statusCode: 503,
        code: 'planning_persistence_read_failed',
        error: 'Planning persistence read failed',
        reason: 'planning_persistence_read_failed',
        configured: authority.validation.configured,
        usable: authority.validation.usable,
        required: authority.validation.required,
        ready: authority.ready,
        status: authority.status,
        governance: getPlanningPersistenceHealth(
          source.planningPersistenceConfig,
          source.planningPersistenceState,
        ).governance,
        detail: String(error && error.message ? error.message : error),
      }),
    };
  }
}

async function persistPlanningRecordToAuthority(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const authority = resolvePlanningPersistenceAuthorityState(
    source.planningPersistenceConfig,
    source.planningPersistenceState,
  );

  if (!authority.persistedAuthority) {
    return {
      ok: true,
      persistedAuthority: false,
      record: source.record,
    };
  }

  if (!authority.ready) {
    const reasonCode = resolveWs5aPersistenceAuthorityReasonCode(authority, source.planningPersistenceState);
    return {
      ok: false,
      failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
        statusCode: 503,
        code: 'planning_persistence_unavailable',
        error: 'Planning persistence unavailable',
        reason: reasonCode,
        configured: authority.validation.configured,
        usable: authority.validation.usable,
        required: authority.validation.required,
        ready: authority.ready,
        status: authority.status,
        governance: getPlanningPersistenceHealth(
          source.planningPersistenceConfig,
          source.planningPersistenceState,
        ).governance,
      }),
    };
  }

  try {
    const persisted = await persistPlanningRecord(authority.client, {
      actorId: source.context && source.context.userId,
      record: source.record,
    });

    if (!persisted.ok) {
      const reason = persisted.error && persisted.error.reason
        ? persisted.error.reason
        : 'planning_persistence_write_failed';
      const code = persisted.error && persisted.error.code
        ? persisted.error.code
        : 'planning_persistence_write_failed';

      return {
        ok: false,
        failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
          statusCode: code === 'scope_visibility_denied' ? 403 : 503,
          code,
          error: 'Planning persistence write failed',
          reason,
          configured: authority.validation.configured,
          usable: authority.validation.usable,
          required: authority.validation.required,
          ready: authority.ready,
          status: authority.status,
          governance: getPlanningPersistenceHealth(
            source.planningPersistenceConfig,
            source.planningPersistenceState,
          ).governance,
        }),
      };
    }

    return {
      ok: true,
      persistedAuthority: true,
      record: persisted.record || source.record,
    };
  } catch {
    return {
      ok: false,
      failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
        statusCode: 503,
        code: 'planning_persistence_write_failed',
        error: 'Planning persistence write failed',
        reason: 'planning_persistence_write_failed',
        configured: authority.validation.configured,
        usable: authority.validation.usable,
        required: authority.validation.required,
        ready: authority.ready,
        status: authority.status,
        governance: getPlanningPersistenceHealth(
          source.planningPersistenceConfig,
          source.planningPersistenceState,
        ).governance,
      }),
    };
  }
}

function buildPlanningDurabilityPersistenceFailure(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return buildPlanningPersistenceFailure(source.pathname, source.method, {
    statusCode: Number.isFinite(source.statusCode) ? Number(source.statusCode) : 503,
    code: String(source.code || '').trim() || 'planning_persistence_write_failed',
    error: String(source.error || 'Planning durability persistence failed'),
    reason: String(source.reason || '').trim() || 'planning_persistence_write_failed',
    configured: source.authority && source.authority.validation
      ? source.authority.validation.configured
      : false,
    usable: source.authority && source.authority.validation
      ? source.authority.validation.usable
      : false,
    required: source.authority && source.authority.validation
      ? source.authority.validation.required
      : false,
    ready: source.authority ? source.authority.ready : false,
    status: source.authority ? source.authority.status : null,
    governance: getPlanningPersistenceHealth(
      source.planningPersistenceConfig,
      source.planningPersistenceState,
    ).governance,
    corruption: buildPlanningPersistenceCorruptionEnvelope(source.planningPersistenceState),
  });
}

async function resolvePlanningDurabilityWriteAuthority(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const operationAuthority = resolvePlanningPersistenceOperationClient({
    pathname: source.pathname,
    method: source.method,
    planningPersistenceConfig: source.planningPersistenceConfig,
    planningPersistenceState: source.planningPersistenceState,
  });

  if (!operationAuthority.ok) {
    return operationAuthority;
  }

  const blockedFailure = buildPlanningPersistenceWriteBlockedFailure(
    source.pathname,
    source.method,
    source.planningPersistenceConfig,
    source.planningPersistenceState,
    operationAuthority.authority,
  );

  if (blockedFailure) {
    return {
      ok: false,
      authority: operationAuthority.authority,
      failure: blockedFailure,
    };
  }

  return operationAuthority;
}

function resolvePlanningDurabilityArtifactErrorStatusCode(error, { missingReason, invalidCode }) {
  const source = error && typeof error === 'object' ? error : {};
  const code = String(source.code || '').trim();
  const reason = String(source.reason || '').trim();

  if (code === 'scope_visibility_denied') {
    return 403;
  }

  if (code === invalidCode && reason === missingReason) {
    return 400;
  }

  if (code === invalidCode && reason.endsWith('_shape_invalid')) {
    return 400;
  }

  if (code === invalidCode && reason.endsWith('_not_found')) {
    return 404;
  }

  if (code === invalidCode && reason.endsWith('_corrupt')) {
    return 503;
  }

  return 503;
}

function buildPlanningDurabilityArtifactFailureEnvelope(pathname, method, { error, statusCode }) {
  const normalizedError = error && typeof error === 'object' ? error : {};
  return {
    statusCode: Number.isFinite(statusCode) ? Number(statusCode) : 503,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: resolvePlanningDurabilityGateKind(pathname, method),
      deterministic: true,
      error: {
        code: String(normalizedError.code || '').trim() || 'planning_persistence_operation_failed',
        reason: String(normalizedError.reason || '').trim() || 'planning_persistence_operation_failed',
      },
    },
  };
}

function mapPersistedMergeIdempotencyRecordToRuntime(record) {
  if (!record || typeof record !== 'object') return null;
  const expiresAtMs = parseIsoMs(record.expiresAt);
  const createdAtMs = parseIsoMs(record.createdAt);

  return {
    idempotencyKey: String(record.idempotencyKey || ''),
    payloadHash: String(record.payloadHash || ''),
    response: cloneJsonValue(record.response && typeof record.response === 'object' ? record.response : {}),
    createdAtMs: createdAtMs == null ? Date.now() : createdAtMs,
    expiresAtMs: expiresAtMs == null ? Date.now() : expiresAtMs,
  };
}

async function hydratePlanningMergeDurabilityStateFromAuthority(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const state = ensurePlanningMergeState(source.planningApiState);
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  const authority = source.authority;
  const nowMs = Number.isFinite(source.nowMs) ? Number(source.nowMs) : Date.now();

  if (!authority || !authority.ready || !authority.client) {
    return { ok: true };
  }

  const compareReceiptId = String(payload.compareReceiptId || '').trim();
  if (compareReceiptId && !state.compareReceipts.has(compareReceiptId)) {
    const persistedReceipt = await readPlanningCompareReceipt(authority.client, {
      receiptId: compareReceiptId,
      nowMs,
    });

    if (persistedReceipt.ok && persistedReceipt.receipt) {
      state.compareReceipts.set(compareReceiptId, persistedReceipt.receipt);
    } else if (persistedReceipt.error && persistedReceipt.error.reason === 'compare_receipt_expired') {
      return {
        ok: false,
        statusCode: 409,
        body: {
          contractVersion: PLANNING_API_CONTRACT_VERSION,
          kind: String(source.kind || 'planning.merge-intent'),
          deterministic: true,
          error: persistedReceipt.error,
        },
      };
    }
  }

  const tokenId = String(payload.tokenId || '').trim();
  if (tokenId && !state.mergeIntentTokens.has(tokenId)) {
    const persistedToken = await readPlanningMergeIntent(authority.client, {
      tokenId,
      nowMs,
    });

    if (persistedToken.ok && persistedToken.token) {
      state.mergeIntentTokens.set(tokenId, persistedToken.token);
    } else if (persistedToken.error && persistedToken.error.reason === 'token_expired') {
      return {
        ok: false,
        statusCode: 409,
        body: {
          contractVersion: PLANNING_API_CONTRACT_VERSION,
          kind: String(source.kind || 'planning.merge'),
          deterministic: true,
          error: persistedToken.error,
        },
      };
    }
  }

  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (idempotencyKey && !state.mergeIdempotencyRecords.has(idempotencyKey)) {
    const persistedIdempotency = await readPlanningMergeIdempotencyRecord(authority.client, {
      idempotencyKey,
      nowMs,
    });

    if (!persistedIdempotency.ok) {
      return {
        ok: false,
        failure: buildPlanningDurabilityPersistenceFailure({
          pathname: source.pathname,
          method: source.method,
          planningPersistenceConfig: source.planningPersistenceConfig,
          planningPersistenceState: source.planningPersistenceState,
          authority,
          code: persistedIdempotency.error && persistedIdempotency.error.code,
          reason: persistedIdempotency.error && persistedIdempotency.error.reason,
          error: 'Planning merge idempotency ledger read failed',
          statusCode: 503,
        }),
      };
    }

    if (persistedIdempotency.record) {
      const runtimeRecord = mapPersistedMergeIdempotencyRecordToRuntime(persistedIdempotency.record);
      if (runtimeRecord) {
        state.mergeIdempotencyRecords.set(idempotencyKey, runtimeRecord);
      }
    }
  }

  return { ok: true };
}

async function persistPlanningMergeCommitDurabilityArtifacts(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const operationBody = source.operationBody && typeof source.operationBody === 'object'
    ? source.operationBody
    : {};
  const mergeEvent = operationBody.mergeEvent && typeof operationBody.mergeEvent === 'object'
    ? operationBody.mergeEvent
    : null;
  const idempotency = operationBody.idempotency && typeof operationBody.idempotency === 'object'
    ? operationBody.idempotency
    : null;
  const authority = source.authority;

  if (!authority || !authority.ready || !authority.client || !mergeEvent || !idempotency) {
    return {
      ok: false,
      failure: buildPlanningDurabilityPersistenceFailure({
        pathname: source.pathname,
        method: source.method,
        planningPersistenceConfig: source.planningPersistenceConfig,
        planningPersistenceState: source.planningPersistenceState,
        authority,
        code: 'planning_merge_durability_write_invalid',
        reason: 'planning_merge_durability_write_invalid',
        error: 'Planning merge durability write invalid',
        statusCode: 503,
      }),
    };
  }

  const tokenWrite = await consumePlanningMergeIntent(authority.client, {
    tokenId: mergeEvent.tokenId,
    consumedAt: mergeEvent.consumedAt,
    nowMs: source.nowMs,
  });

  if (!tokenWrite.ok) {
    return {
      ok: false,
      failure: buildPlanningDurabilityPersistenceFailure({
        pathname: source.pathname,
        method: source.method,
        planningPersistenceConfig: source.planningPersistenceConfig,
        planningPersistenceState: source.planningPersistenceState,
        authority,
        code: tokenWrite.error && tokenWrite.error.code,
        reason: tokenWrite.error && tokenWrite.error.reason,
        error: 'Planning merge intent consume persistence failed',
        statusCode: tokenWrite.error && tokenWrite.error.code === 'invalid_confirmation_token' ? 409 : 503,
      }),
    };
  }

  const payloadHash = hashMergePayload({
    idempotencyKey: idempotency.key,
    actorId: mergeEvent.actorId,
    targetId: mergeEvent.targetId,
    sourceIdsHash: mergeEvent.sourceIdsHash,
    compareHash: mergeEvent.compareHash,
    operationType: 'merge',
  });

  const idempotencyWrite = await persistPlanningMergeIdempotencyRecord(authority.client, {
    idempotencyKey: idempotency.key,
    actorId: mergeEvent.actorId,
    repoId: source.context && source.context.repoId,
    operationType: 'merge',
    targetId: mergeEvent.targetId,
    sourceIdsHash: mergeEvent.sourceIdsHash,
    compareHash: mergeEvent.compareHash,
    payloadHash,
    mergeRecordId: source.mergeRecord && source.mergeRecord.recordId,
    response: operationBody,
    nowMs: source.nowMs,
    ttlMs: PLANNING_MERGE_IDEMPOTENCY_TTL_MS,
  });

  if (!idempotencyWrite.ok) {
    await resetPlanningMergeIntentConsumption(authority.client, {
      tokenId: mergeEvent.tokenId,
    });

    return {
      ok: false,
      failure: buildPlanningDurabilityPersistenceFailure({
        pathname: source.pathname,
        method: source.method,
        planningPersistenceConfig: source.planningPersistenceConfig,
        planningPersistenceState: source.planningPersistenceState,
        authority,
        code: idempotencyWrite.error && idempotencyWrite.error.code,
        reason: idempotencyWrite.error && idempotencyWrite.error.reason,
        error: 'Planning merge idempotency ledger persistence failed',
        statusCode: idempotencyWrite.error && idempotencyWrite.error.code === 'idempotency_conflict' ? 409 : 503,
      }),
    };
  }

  return {
    ok: true,
    record: idempotencyWrite.record || null,
  };
}

async function compensatePlanningMergeDurabilityFailure(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const authority = source.authority;
  const operationBody = source.operationBody && typeof source.operationBody === 'object'
    ? source.operationBody
    : {};
  const mergeEvent = operationBody.mergeEvent && typeof operationBody.mergeEvent === 'object'
    ? operationBody.mergeEvent
    : null;
  const idempotency = operationBody.idempotency && typeof operationBody.idempotency === 'object'
    ? operationBody.idempotency
    : null;

  if (!authority || !authority.ready || !authority.client) {
    return;
  }

  if (idempotency && typeof idempotency.key === 'string' && idempotency.key.trim()) {
    await deletePlanningMergeIdempotencyRecord(authority.client, {
      idempotencyKey: idempotency.key,
    });
  }

  if (mergeEvent && typeof mergeEvent.tokenId === 'string' && mergeEvent.tokenId.trim()) {
    await resetPlanningMergeIntentConsumption(authority.client, {
      tokenId: mergeEvent.tokenId,
    });
  }

  if (source.mergeRecord && typeof source.mergeRecord.recordId === 'string' && source.mergeRecord.recordId.trim()) {
    await deletePersistedPlanningRecordById(authority.client, {
      actorId: source.context && source.context.userId,
      recordId: source.mergeRecord.recordId,
    });
  }
}

function parseDeterministicBooleanFlag(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return null;
}

const PLANNING_MERGE_MAX_TOKEN_TTL_MS = 15 * 60 * 1000;
const PLANNING_MERGE_DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const PLANNING_COMPARE_RECEIPT_TTL_MS = 10 * 60 * 1000;
const PLANNING_MERGE_IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
const PLANNING_MERGE_STATE_MAX_ITEMS = 5000;

function stableNormalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableNormalizeValue(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      out[key] = stableNormalizeValue(value[key]);
    }
    return out;
  }
  return value;
}

function stableHashValue(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableNormalizeValue(value)), 'utf8')
    .digest('hex');
}

function legacyStableHash(value) {
  const normalized = JSON.stringify(stableNormalizeValue(value));
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePlanningVersionVectorHash(versionVector) {
  return stableHashValue(versionVector || null);
}

function buildPlanningCompareSnapshotHash(compareBody = {}) {
  return legacyStableHash({
    requestedScopes: Array.isArray(compareBody.requestedScopes) ? compareBody.requestedScopes : [],
    deniedScopes: Array.isArray(compareBody.deniedScopes) ? compareBody.deniedScopes : [],
    pinnedVersion: compareBody.versionVector && compareBody.versionVector.pinned
      ? compareBody.versionVector.pinned
      : null,
    matchIds: Array.isArray(compareBody.matches)
      ? compareBody.matches.map((entry) => String((entry && entry.recordId) || ''))
      : [],
  });
}

function buildPlanningSourceIdsHash(sourceIds = []) {
  const normalized = [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return legacyStableHash(normalized);
}

function normalizeDeterministicReasonCodes(values) {
  const list = Array.isArray(values) ? values : [];
  const normalized = [];
  for (const value of list) {
    const reason = String(value || '').trim();
    if (!reason) continue;
    normalized.push(reason);
  }
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function evaluatePlanningDurabilityDependencyGate(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const env = source.env && typeof source.env === 'object' ? source.env : process.env;
  const reasonCodes = [];

  if (parseDeterministicBooleanFlag(env.INSTRUCTION_ENGINE_FORCE_WS3_AUTHORITY_GATE_BLOCKED) === true) {
    reasonCodes.push('ws3_authority_gate_forced_blocked');
  }

  const sessionReconciliationContractVersion = String(SESSION_RECONCILIATION_CONTRACT_VERSION || '').trim();
  if (!sessionReconciliationContractVersion) {
    reasonCodes.push('ws3_reconciliation_contract_version_missing');
  }

  const planningPrecedenceContractVersion = String(planState.PLANNING_PRECEDENCE_CONTRACT_VERSION || '').trim();
  if (!planningPrecedenceContractVersion) {
    reasonCodes.push('ws3_planning_precedence_contract_version_missing');
  }

  const requiredAuthorities = [
    String(SESSION_STATE_AUTHORITIES.RUNTIME || '').trim(),
    String(SESSION_STATE_AUTHORITIES.RUNTIME_ONLY || '').trim(),
    String(SESSION_STATE_AUTHORITIES.ARTIFACT || '').trim(),
  ].filter(Boolean);
  const availableAuthorities = new Set(
    Object.values(SESSION_STATE_AUTHORITIES || {})
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );

  if (!availableAuthorities.has(SESSION_STATE_AUTHORITIES.RUNTIME)) {
    reasonCodes.push('ws3_authority_acp_missing');
  }
  if (!availableAuthorities.has(SESSION_STATE_AUTHORITIES.RUNTIME_ONLY)) {
    reasonCodes.push('ws3_authority_acp_only_missing');
  }
  if (!availableAuthorities.has(SESSION_STATE_AUTHORITIES.ARTIFACT)) {
    reasonCodes.push('ws3_authority_fs_missing');
  }

  const runtimeSourcePrecedence = Number(
    SESSION_RECONCILIATION_SOURCE_PRECEDENCE[SESSION_RECONCILIATION_SOURCES.RUNTIME] || 0,
  );
  const artifactSourcePrecedence = Number(
    SESSION_RECONCILIATION_SOURCE_PRECEDENCE[SESSION_RECONCILIATION_SOURCES.ARTIFACT] || 0,
  );

  if (!(runtimeSourcePrecedence > artifactSourcePrecedence)) {
    reasonCodes.push('ws3_source_precedence_not_runtime_over_artifact');
  }

  if (
    SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME]
    !== SESSION_RECONCILIATION_SOURCES.RUNTIME
  ) {
    reasonCodes.push('ws3_source_of_truth_runtime_mismatch');
  }
  if (
    SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME_ONLY]
    !== SESSION_RECONCILIATION_SOURCES.RUNTIME
  ) {
    reasonCodes.push('ws3_source_of_truth_runtime_only_mismatch');
  }
  if (
    SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.ARTIFACT]
    !== SESSION_RECONCILIATION_SOURCES.ARTIFACT
  ) {
    reasonCodes.push('ws3_source_of_truth_artifact_mismatch');
  }

  const userScopePrecedence = Number(planState.PLANNING_SCOPE_PRECEDENCE.user || 0);
  const repoScopePrecedence = Number(planState.PLANNING_SCOPE_PRECEDENCE.repo || 0);
  const globalScopePrecedence = Number(planState.PLANNING_SCOPE_PRECEDENCE.global || 0);
  if (!(userScopePrecedence > repoScopePrecedence && repoScopePrecedence > globalScopePrecedence)) {
    reasonCodes.push('ws3_scope_precedence_invalid');
  }

  const normalizedReasonCodes = normalizeDeterministicReasonCodes(reasonCodes);
  const ready = normalizedReasonCodes.length === 0;

  return {
    contractVersion: WS3_AUTHORITY_DEPENDENCY_GATE_CONTRACT_VERSION,
    dependency: WS3_AUTHORITY_DEPENDENCY_NAME,
    deterministic: true,
    required: true,
    ready,
    marker: ready ? 'ready' : 'dependency-blocked',
    reason: ready ? 'ws3_authority_contract_ready' : normalizedReasonCodes[0],
    reasonCodes: ready ? ['ws3_authority_contract_ready'] : normalizedReasonCodes,
    ws3: {
      sessionReconciliationContractVersion: sessionReconciliationContractVersion || null,
      planningPrecedenceContractVersion: planningPrecedenceContractVersion || null,
      authorities: requiredAuthorities,
      sourcePrecedence: {
        runtime: runtimeSourcePrecedence,
        artifact: artifactSourcePrecedence,
      },
      sourceOfTruth: {
        runtime: SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME] || null,
        runtimeOnly: SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME_ONLY] || null,
        artifact: SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.ARTIFACT] || null,
      },
      planningScopePrecedence: {
        user: userScopePrecedence,
        repo: repoScopePrecedence,
        global: globalScopePrecedence,
      },
    },
  };
}

function isPlanningDurabilityRoute(pathname) {
  const route = String(pathname || '').trim();
  return (
    route === '/api/planning/records'
    || route === '/api/planning/search'
    || route === '/api/planning/compare'
    || route === '/api/planning/merge-intent'
    || route === '/api/planning/merge'
    || route === '/api/planning/suggestions'
    || route === '/api/planning/recaps'
    || route === '/api/planning/workflow-artifacts'
    || route === '/api/planning/persistence/init'
    || route === '/api/planning/persistence/retention'
    || route === '/api/planning/persistence/export'
    || route === '/api/planning/persistence/import'
    || route === '/api/planning/persistence/corruption/scan'
  );
}

function resolvePlanningDurabilityGateKind(pathname, method) {
  const route = String(pathname || '').trim();
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();

  if (route === '/api/planning/records') {
    return normalizedMethod === 'POST' ? 'planning.create' : 'planning.list';
  }
  if (route === '/api/planning/search') {
    return 'planning.search';
  }
  if (route === '/api/planning/compare') {
    return 'planning.compare';
  }
  if (route === '/api/planning/merge-intent') {
    return 'planning.merge-intent';
  }
  if (route === '/api/planning/merge') {
    return 'planning.merge';
  }
  if (route === '/api/planning/suggestions') {
    return normalizedMethod === 'POST' ? 'planning.suggestion.persist' : 'planning.suggestion.read';
  }
  if (route === '/api/planning/recaps') {
    return normalizedMethod === 'POST' ? 'planning.recap.persist' : 'planning.recap.read';
  }
  if (route === '/api/planning/workflow-artifacts') {
    return normalizedMethod === 'POST'
      ? 'planning.workflow-artifact.persist'
      : 'planning.workflow-artifact.read';
  }
  if (route === '/api/planning/persistence/init') {
    return 'planning.persistence.init';
  }
  if (route === '/api/planning/persistence/retention') {
    return 'planning.persistence.retention';
  }
  if (route === '/api/planning/persistence/export') {
    return 'planning.persistence.export';
  }
  if (route === '/api/planning/persistence/import') {
    return 'planning.persistence.import';
  }
  if (route === '/api/planning/persistence/corruption/scan') {
    return 'planning.persistence.corruption.scan';
  }

  return 'planning.unknown';
}

function buildPlanningDurabilityDependencyGateFailure(pathname, method, gateState) {
  const gate = gateState && typeof gateState === 'object' ? gateState : {};
  const reason = String(gate.reason || '').trim() || 'ws3_authority_contract_not_ready';

  return {
    statusCode: 503,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: resolvePlanningDurabilityGateKind(pathname, method),
      deterministic: true,
      error: 'Planning durability dependency gate blocked',
      code: WS3_AUTHORITY_DEPENDENCY_BLOCK_CODE,
      reason,
      dependencyGate: {
        marker: 'dependency-blocked',
        dependency: String(gate.dependency || WS3_AUTHORITY_DEPENDENCY_NAME),
        required: true,
        ready: false,
        contractVersion: String(gate.contractVersion || WS3_AUTHORITY_DEPENDENCY_GATE_CONTRACT_VERSION),
        reasonCodes: normalizeDeterministicReasonCodes(gate.reasonCodes && gate.reasonCodes.length
          ? gate.reasonCodes
          : [reason]),
        ws3: gate.ws3 || null,
      },
    },
  };
}

function isPlanningDurabilityCriticalRoute(pathname) {
  const route = String(pathname || '').trim();
  return WS5A_DURABILITY_CRITICAL_ROUTES.has(route);
}

function resolveWs5aPersistenceAuthorityReasonCode(authority, planningPersistenceState) {
  const status = String(authority && authority.status || '').trim();
  const migrations = planningPersistenceState
    && typeof planningPersistenceState === 'object'
    && planningPersistenceState.migrations
    && typeof planningPersistenceState.migrations === 'object'
    ? planningPersistenceState.migrations
    : {};
  const checksumValidation = migrations.checksumValidation
    && typeof migrations.checksumValidation === 'object'
    ? migrations.checksumValidation
    : {};

  if (status === 'configured_no_client') {
    return 'planning_persistence_client_unavailable';
  }

  if (status === 'drift_detected') {
    return checksumValidation.baselineMismatch === true || migrations.baselineMismatch === true
      ? 'planning_persistence_checksum_baseline_mismatch'
      : 'planning_persistence_checksum_drift';
  }

  if (status === 'migration_error') {
    return 'planning_persistence_migration_error';
  }

  if (status === 'invalid_config') {
    return 'planning_persistence_invalid_config';
  }

  if (status === 'disabled') {
    return 'planning_persistence_not_configured';
  }

  return 'planning_persistence_not_ready';
}

function resolvePlanningDurabilityRouteGateState(pathname, method, planningPersistenceConfig, planningPersistenceState) {
  const route = String(pathname || '').trim();
  const authority = resolvePlanningPersistenceAuthorityState(
    planningPersistenceConfig,
    planningPersistenceState,
  );
  const migrationVersions = Array.isArray(PLANNING_WS5A_DURABILITY_REQUIRED_MIGRATION_VERSIONS)
    ? PLANNING_WS5A_DURABILITY_REQUIRED_MIGRATION_VERSIONS
    : [];

  const checkedVersions = normalizeDeterministicReasonCodes(
    planningPersistenceState
    && planningPersistenceState.migrations
    && planningPersistenceState.migrations.checksumValidation
    && Array.isArray(planningPersistenceState.migrations.checksumValidation.checkedVersions)
      ? planningPersistenceState.migrations.checksumValidation.checkedVersions
      : [],
  );

  const missingMigrationVersions = migrationVersions
    .filter((version) => !checkedVersions.includes(version))
    .sort((a, b) => a.localeCompare(b));

  const reasonCodes = [];
  let primaryReason = 'ws5a_durability_route_ready';
  if (!authority.persistedAuthority) {
    primaryReason = 'planning_persistence_not_configured';
    reasonCodes.push(primaryReason);
  } else if (!authority.ready) {
    primaryReason = resolveWs5aPersistenceAuthorityReasonCode(authority, planningPersistenceState);
    reasonCodes.push(primaryReason);
  }

  if (authority.ready && missingMigrationVersions.length > 0) {
    primaryReason = 'planning_durability_artifact_migrations_missing';
    reasonCodes.push(primaryReason);
  }

  const normalizedReasonCodes = normalizeDeterministicReasonCodes(reasonCodes);
  const ready = normalizedReasonCodes.length === 0;

  if (!ready && !normalizedReasonCodes.includes(primaryReason)) {
    primaryReason = normalizedReasonCodes[0] || 'planning_persistence_not_ready';
  }

  return {
    contractVersion: WS5A_DURABILITY_ROUTE_GATE_CONTRACT_VERSION,
    dependency: WS5A_DURABILITY_ROUTE_GATE_NAME,
    deterministic: true,
    required: isPlanningDurabilityCriticalRoute(route),
    ready,
    marker: ready ? 'ready' : 'dependency-blocked',
    reason: ready ? 'ws5a_durability_route_ready' : primaryReason,
    reasonCodes: ready ? ['ws5a_durability_route_ready'] : normalizedReasonCodes,
    kind: resolvePlanningDurabilityGateKind(pathname, method),
    migrationVersions,
    checkedMigrationVersions: checkedVersions,
    missingMigrationVersions,
    debug: {
      persistenceAuthorityStatus: authority.status,
      persistenceAuthorityLastError: authority.lastError,
    },
    persistenceAuthority: {
      persistedAuthority: authority.persistedAuthority,
      ready: authority.ready,
      status: authority.status,
      lastError: authority.lastError,
    },
  };
}

function buildPlanningDurabilityRouteGateFailure(pathname, method, gateState) {
  const gate = gateState && typeof gateState === 'object' ? gateState : {};
  const reason = String(gate.reason || '').trim() || 'planning_persistence_not_ready';

  return {
    statusCode: 503,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: resolvePlanningDurabilityGateKind(pathname, method),
      deterministic: true,
      error: 'Planning durability route gate blocked',
      code: WS5A_DURABILITY_ROUTE_BLOCK_CODE,
      reason,
      durabilityRouteGate: {
        marker: 'dependency-blocked',
        dependency: String(gate.dependency || WS5A_DURABILITY_ROUTE_GATE_NAME),
        required: true,
        ready: false,
        contractVersion: String(gate.contractVersion || WS5A_DURABILITY_ROUTE_GATE_CONTRACT_VERSION),
        reasonCodes: normalizeDeterministicReasonCodes(gate.reasonCodes && gate.reasonCodes.length
          ? gate.reasonCodes
          : [reason]),
        debug: gate.debug && typeof gate.debug === 'object'
          ? {
            persistenceAuthorityStatus: String(gate.debug.persistenceAuthorityStatus || '').trim() || null,
            persistenceAuthorityLastError: String(gate.debug.persistenceAuthorityLastError || '').trim() || null,
          }
          : null,
        migrationVersions: Array.isArray(gate.migrationVersions) ? gate.migrationVersions : [],
        checkedMigrationVersions: Array.isArray(gate.checkedMigrationVersions) ? gate.checkedMigrationVersions : [],
        missingMigrationVersions: Array.isArray(gate.missingMigrationVersions) ? gate.missingMigrationVersions : [],
        persistenceAuthority: gate.persistenceAuthority || null,
      },
    },
  };
}

function normalizePlanningDowngradeMarker(input = {}, fallbackMarker = 'conflict') {
  const marker = input && typeof input === 'object' ? input : {};
  const markerToken = String(marker.marker || fallbackMarker).trim().toLowerCase();
  const normalizedMarker = markerToken === 'stale'
    ? 'stale'
    : markerToken === 'conflict'
      ? 'conflict'
      : fallbackMarker;

  const statusToken = String(marker.status || (normalizedMarker === 'stale' ? 'stale' : 'invalid')).trim().toLowerCase();
  const status = statusToken || (normalizedMarker === 'stale' ? 'stale' : 'invalid');
  const reason = String(
    marker.reason
    || marker.reasonCode
    || (normalizedMarker === 'stale' ? 'source_stale' : 'source_conflict')
  ).trim() || (normalizedMarker === 'stale' ? 'source_stale' : 'source_conflict');

  return {
    sourceId: String(marker.sourceId || '').trim() || null,
    sourceType: String(marker.sourceType || '').trim() || null,
    path: String(marker.path || '').trim() || null,
    scope: String(marker.scope || '').trim() || null,
    status,
    reason,
    marker: normalizedMarker,
  };
}

function sortPlanningDowngradeMarkers(markers) {
  return markers.sort((a, b) => {
    const sourceDiff = String(a.sourceId || '').localeCompare(String(b.sourceId || ''));
    if (sourceDiff !== 0) return sourceDiff;
    const scopeDiff = String(a.scope || '').localeCompare(String(b.scope || ''));
    if (scopeDiff !== 0) return scopeDiff;
    return String(a.reason || '').localeCompare(String(b.reason || ''));
  });
}

function dedupePlanningDowngradeMarkers(markers) {
  const deduped = new Map();
  for (const marker of markers) {
    const normalized = normalizePlanningDowngradeMarker(marker, marker && marker.marker === 'stale' ? 'stale' : 'conflict');
    const key = [
      String(normalized.marker || ''),
      String(normalized.sourceId || ''),
      String(normalized.scope || ''),
      String(normalized.reason || ''),
      String(normalized.status || ''),
    ].join('|');
    if (!deduped.has(key)) {
      deduped.set(key, normalized);
    }
  }
  return sortPlanningDowngradeMarkers(Array.from(deduped.values()));
}

function derivePlanningDowngradeMarkers(compareBody = {}) {
  const implementedOutcomes = compareBody && typeof compareBody.implementedOutcomes === 'object'
    ? compareBody.implementedOutcomes
    : {};
  const sourceMarkers = Array.isArray(implementedOutcomes.sources)
    ? implementedOutcomes.sources
    : [];

  let staleMarkers = Array.isArray(implementedOutcomes.staleMarkers)
    ? implementedOutcomes.staleMarkers.map((marker) => normalizePlanningDowngradeMarker(marker, 'stale'))
    : [];
  let conflictMarkers = Array.isArray(implementedOutcomes.conflictMarkers)
    ? implementedOutcomes.conflictMarkers.map((marker) => normalizePlanningDowngradeMarker(marker, 'conflict'))
    : [];

  const deriveStaleFromSources = staleMarkers.length === 0;
  const deriveConflictFromSources = conflictMarkers.length === 0;

  if (deriveStaleFromSources || deriveConflictFromSources) {
    for (const marker of sourceMarkers) {
      const normalized = normalizePlanningDowngradeMarker(marker, 'conflict');
      if (deriveStaleFromSources && normalized.status === 'stale') {
        staleMarkers.push({ ...normalized, marker: 'stale' });
      }
      if (deriveConflictFromSources && (normalized.status === 'invalid' || normalized.status === 'unavailable')) {
        conflictMarkers.push({ ...normalized, marker: 'conflict' });
      }
    }
  }

  if (compareBody.newerDataAvailable === true) {
    staleMarkers.push(normalizePlanningDowngradeMarker({
      sourceId: 'version-vector',
      sourceType: 'version-vector',
      status: 'stale',
      reason: 'newer_data_available',
      marker: 'stale',
    }, 'stale'));
  }

  const deniedScopes = [...new Set((Array.isArray(compareBody.deniedScopes) ? compareBody.deniedScopes : [])
    .map((scope) => String(scope || '').trim().toLowerCase())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  for (const scope of deniedScopes) {
    conflictMarkers.push(normalizePlanningDowngradeMarker({
      sourceId: `scope:${scope}`,
      sourceType: 'scope',
      scope,
      status: 'invalid',
      reason: 'denied_scope_present',
      marker: 'conflict',
    }, 'conflict'));
  }

  staleMarkers = dedupePlanningDowngradeMarkers(staleMarkers);
  conflictMarkers = dedupePlanningDowngradeMarkers(conflictMarkers);

  const reasonCodes = normalizeDeterministicReasonCodes([
    ...staleMarkers.map((marker) => marker.reason),
    ...conflictMarkers.map((marker) => marker.reason),
    ...(Array.isArray(implementedOutcomes.reasonCodes) ? implementedOutcomes.reasonCodes : []),
  ]);

  return {
    deterministic: true,
    staleMarkers,
    conflictMarkers,
    reasonCodes,
    hasStaleMarkers: staleMarkers.length > 0,
    hasConflictMarkers: conflictMarkers.length > 0,
  };
}

function evaluatePlanningMergeGateState(compareBody = {}) {
  const deniedScopes = Array.isArray(compareBody.deniedScopes) ? compareBody.deniedScopes : [];
  const matches = Array.isArray(compareBody.matches) ? compareBody.matches : [];
  const downgradeBase = derivePlanningDowngradeMarkers(compareBody);
  const conditionReasonCodes = normalizeDeterministicReasonCodes([
    deniedScopes.length ? 'denied_scopes_present' : '',
    !matches.length ? 'no_compare_matches' : '',
    compareBody.newerDataAvailable === true ? 'newer_data_available' : '',
    downgradeBase.hasConflictMarkers ? 'implemented_source_conflict' : '',
    downgradeBase.hasStaleMarkers ? 'implemented_source_stale' : '',
  ]);

  function buildDowngrade(primaryReason, downgraded) {
    const reasonCodes = normalizeDeterministicReasonCodes([
      ...downgradeBase.reasonCodes,
      ...conditionReasonCodes,
      primaryReason,
    ]);

    return {
      ...downgradeBase,
      primaryReason,
      downgraded,
      reasonCodes,
    };
  }

  if (deniedScopes.length) {
    return {
      gateState: 'auth-denied',
      mergeEligible: false,
      reason: 'denied_scopes_present',
      downgrade: buildDowngrade('denied_scopes_present', true),
    };
  }
  if (!matches.length) {
    return {
      gateState: 'insufficient-data',
      mergeEligible: false,
      reason: 'no_compare_matches',
      downgrade: buildDowngrade('no_compare_matches', true),
    };
  }
  if (compareBody.newerDataAvailable === true) {
    return {
      gateState: 'degraded',
      mergeEligible: false,
      reason: 'newer_data_available',
      downgrade: buildDowngrade('newer_data_available', true),
    };
  }
  if (downgradeBase.hasConflictMarkers || downgradeBase.hasStaleMarkers) {
    return {
      gateState: 'degraded',
      mergeEligible: false,
      reason: 'implemented_source_not_available',
      downgrade: buildDowngrade('implemented_source_not_available', true),
    };
  }
  return {
    gateState: 'pass',
    mergeEligible: true,
    reason: 'gate_pass',
    downgrade: buildDowngrade('gate_pass', false),
  };
}

function ensurePlanningMergeState(planningApiState) {
  const state = planningApiState && typeof planningApiState === 'object'
    ? planningApiState
    : {};

  if (!(state.mergeIntentTokens instanceof Map)) {
    state.mergeIntentTokens = new Map();
  }
  if (!(state.mergeIdempotencyRecords instanceof Map)) {
    state.mergeIdempotencyRecords = new Map();
  }
  if (!(state.compareReceipts instanceof Map)) {
    state.compareReceipts = new Map();
  }

  return state;
}

function trimMapToSize(map, maxSize) {
  if (!(map instanceof Map)) return;
  while (map.size > maxSize) {
    const first = map.keys().next();
    if (first.done) break;
    map.delete(first.value);
  }
}

function reapPlanningMergeState(planningApiState, nowMs = Date.now()) {
  const state = ensurePlanningMergeState(planningApiState);
  const now = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();

  for (const [receiptId, receipt] of state.compareReceipts.entries()) {
    const expiresAtMs = parseIsoMs(receipt && receipt.expiresAt);
    if (expiresAtMs != null && now > expiresAtMs) {
      state.compareReceipts.delete(receiptId);
    }
  }

  for (const [tokenId, token] of state.mergeIntentTokens.entries()) {
    const expiresAtMs = parseIsoMs(token && token.expiresAt);
    const consumedAtMs = parseIsoMs(token && token.consumedAt);
    const consumedExpired = consumedAtMs != null && now > (consumedAtMs + PLANNING_MERGE_IDEMPOTENCY_TTL_MS);
    if ((expiresAtMs != null && now > expiresAtMs) || consumedExpired) {
      state.mergeIntentTokens.delete(tokenId);
    }
  }

  for (const [idempotencyKey, record] of state.mergeIdempotencyRecords.entries()) {
    const expiresAtMs = Number.isFinite(record && record.expiresAtMs)
      ? Number(record.expiresAtMs)
      : null;
    if (expiresAtMs != null && now > expiresAtMs) {
      state.mergeIdempotencyRecords.delete(idempotencyKey);
    }
  }

  trimMapToSize(state.compareReceipts, PLANNING_MERGE_STATE_MAX_ITEMS);
  trimMapToSize(state.mergeIntentTokens, PLANNING_MERGE_STATE_MAX_ITEMS);
  trimMapToSize(state.mergeIdempotencyRecords, PLANNING_MERGE_STATE_MAX_ITEMS);

  return state;
}

function parseIsoMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMergeIdList(sourceIds) {
  return [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function recordPlanningCompareReceipt(planningApiState, context, compareBody, nowMs) {
  const state = reapPlanningMergeState(planningApiState, nowMs);
  const actorId = normalizeIdentity(context && context.userId);
  const repoId = normalizeIdentity(context && context.repoId);
  const sourceIds = Array.isArray(compareBody && compareBody.planningRecords)
    ? compareBody.planningRecords.map((entry) => String((entry && entry.recordId) || '').trim()).filter(Boolean)
    : [];
  const gate = evaluatePlanningMergeGateState(compareBody);

  const receiptId = `compare-${nowMs}-${crypto.randomBytes(4).toString('hex')}`;
  const expiresAtMs = nowMs + PLANNING_COMPARE_RECEIPT_TTL_MS;
  const receipt = {
    receiptId,
    actorId,
    repoId,
    compareHash: buildPlanningCompareSnapshotHash(compareBody),
    sourceIdsHash: buildPlanningSourceIdsHash(sourceIds),
    sourceIds,
    versionVector: compareBody && compareBody.versionVector ? compareBody.versionVector.pinned || null : null,
    gateState: gate.gateState,
    mergeEligible: gate.mergeEligible,
    reason: gate.reason,
    downgrade: gate.downgrade,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };

  state.compareReceipts.set(receiptId, receipt);
  return receipt;
}

function resolvePlanningCompareReceipt(planningApiState, receiptId, context, nowMs) {
  const state = reapPlanningMergeState(planningApiState, nowMs);
  const id = String(receiptId || '').trim();
  if (!id) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'missing_compare_receipt_id' } };
  }

  const receipt = state.compareReceipts.get(id);
  if (!receipt) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_not_found' } };
  }

  if (Number(nowMs) > parseIsoMs(receipt.expiresAt)) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_expired' } };
  }

  const actorId = normalizeIdentity(context && context.userId);
  const repoId = normalizeIdentity(context && context.repoId);
  if (!actorId || actorId !== normalizeIdentity(receipt.actorId)) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_actor_mismatch' } };
  }

  const receiptRepoId = normalizeIdentity(receipt.repoId);
  if (receiptRepoId && receiptRepoId !== repoId) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_repo_mismatch' } };
  }

  return { ok: true, receipt };
}

function hashMergePayload(request) {
  const payload = {
    actorId: request && request.actorId ? String(request.actorId) : '',
    targetId: request && request.targetId ? String(request.targetId) : '',
    sourceIdsHash: request && request.sourceIdsHash ? String(request.sourceIdsHash) : '',
    compareHash: request && request.compareHash ? String(request.compareHash) : '',
    operationType: request && request.operationType ? String(request.operationType) : 'merge',
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function validatePlanningMergeConfirmationToken(token, context = {}) {
  if (!token || typeof token !== 'object') {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_not_object' } };
  }

  const requiredFields = ['tokenId', 'actorId', 'sourceIdsHash', 'targetId', 'compareHash', 'issuedAt', 'expiresAt'];
  for (const field of requiredFields) {
    if (typeof token[field] !== 'string' || !token[field].trim()) {
      return { ok: false, error: { code: 'invalid_confirmation_token', reason: `missing_or_invalid_${field}` } };
    }
  }

  const issuedAtMs = parseIsoMs(token.issuedAt);
  const expiresAtMs = parseIsoMs(token.expiresAt);
  if (issuedAtMs == null || expiresAtMs == null || expiresAtMs <= issuedAtMs) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'invalid_token_time_window' } };
  }

  if (expiresAtMs - issuedAtMs > PLANNING_MERGE_MAX_TOKEN_TTL_MS) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_ttl_exceeds_max' } };
  }

  const nowMs = Number.isFinite(context.nowMs) ? Number(context.nowMs) : Date.now();
  if (nowMs > expiresAtMs) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_expired' } };
  }

  if (token.consumedAt != null) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_consumed' } };
  }

  if (context.actorId && String(context.actorId) !== token.actorId) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'actor_mismatch' } };
  }
  if (context.targetId && String(context.targetId) !== token.targetId) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'target_mismatch' } };
  }
  if (context.compareHash && String(context.compareHash) !== token.compareHash) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'compare_hash_mismatch' } };
  }

  return {
    ok: true,
    value: {
      tokenId: token.tokenId,
      actorId: token.actorId,
      sourceIdsHash: token.sourceIdsHash,
      targetId: token.targetId,
      compareHash: token.compareHash,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
    },
  };
}

function validatePlanningMergeIdempotency(request, existingRecord = null) {
  if (!request || typeof request !== 'object') {
    return { ok: false, error: { code: 'invalid_idempotency', reason: 'request_not_object' } };
  }
  if (typeof request.idempotencyKey !== 'string' || !request.idempotencyKey.trim()) {
    return { ok: false, error: { code: 'invalid_idempotency', reason: 'missing_or_invalid_idempotency_key' } };
  }

  const payloadHash = hashMergePayload(request);
  const scopeKey = [
    String(request.actorId || ''),
    String(request.targetId || ''),
    String(request.sourceIdsHash || ''),
    String(request.operationType || 'merge'),
  ].join(':');

  if (!existingRecord) {
    return {
      ok: true,
      replay: false,
      scopeKey,
      payloadHash,
      idempotencyKey: request.idempotencyKey.trim(),
    };
  }

  if (String(existingRecord.idempotencyKey || '') !== request.idempotencyKey.trim()) {
    return {
      ok: true,
      replay: false,
      scopeKey,
      payloadHash,
      idempotencyKey: request.idempotencyKey.trim(),
    };
  }

  if (String(existingRecord.payloadHash || '') !== payloadHash) {
    return { ok: false, error: { code: 'idempotency_conflict', reason: 'idempotency_key_payload_mismatch' } };
  }

  return {
    ok: true,
    replay: true,
    scopeKey,
    payloadHash,
    idempotencyKey: request.idempotencyKey.trim(),
  };
}

function validatePlanningMergeAtomicEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, error: { code: 'invalid_atomic_envelope', reason: 'envelope_not_object' } };
  }

  const required = ['targetUpdate', 'sourceTransitions', 'lineageLinks', 'auditEvent', 'tokenConsumedWrite'];
  for (const field of required) {
    if (envelope[field] == null) {
      return { ok: false, error: { code: 'invalid_atomic_envelope', reason: `missing_${field}` } };
    }
  }

  if (!Array.isArray(envelope.sourceTransitions) || envelope.sourceTransitions.length === 0) {
    return { ok: false, error: { code: 'invalid_atomic_envelope', reason: 'invalid_sourceTransitions' } };
  }

  if (!Array.isArray(envelope.lineageLinks) || envelope.lineageLinks.length === 0) {
    return { ok: false, error: { code: 'invalid_atomic_envelope', reason: 'invalid_lineageLinks' } };
  }

  return { ok: true };
}

function issuePlanningMergeIntent(planningApiState, input = {}) {
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const state = reapPlanningMergeState(planningApiState, nowMs);

  const actorId = normalizeIdentity(context.userId || payload.actorId || payload.userId);
  const repoId = normalizeIdentity(context.repoId || payload.repoId);
  const targetId = String(payload.targetId || '').trim();
  const compareReceiptId = String(payload.compareReceiptId || '').trim();

  if (!actorId) {
    return {
      statusCode: 403,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: { code: 'scope_visibility_denied', reason: 'missing_user_context' },
      },
    };
  }

  if (!targetId || !compareReceiptId) {
    return {
      statusCode: 400,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: { code: 'invalid_compare_receipt', reason: 'missing_merge_intent_fields' },
      },
    };
  }

  const receiptLookup = resolvePlanningCompareReceipt(state, compareReceiptId, context, nowMs);
  if (!receiptLookup.ok) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: receiptLookup.error,
      },
    };
  }

  if (!receiptLookup.receipt.mergeEligible) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: { code: 'merge_gate_blocked', reason: receiptLookup.receipt.reason || 'gate_not_pass' },
        gateState: receiptLookup.receipt.gateState,
        downgrade: receiptLookup.receipt.downgrade || null,
      },
    };
  }

  const sourceIds = normalizeMergeIdList(payload.sourceIds);
  const sourceIdsHash = buildPlanningSourceIdsHash(sourceIds);
  if (sourceIdsHash !== receiptLookup.receipt.sourceIdsHash) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'source_ids_hash_mismatch' },
      },
    };
  }

  const compareHash = receiptLookup.receipt.compareHash;

  const rawTtlMs = Number.isFinite(payload.ttlMs) ? Number(payload.ttlMs) : PLANNING_MERGE_DEFAULT_TOKEN_TTL_MS;
  const ttlMs = Math.max(1_000, Math.min(rawTtlMs, PLANNING_MERGE_MAX_TOKEN_TTL_MS));

  const issuedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const tokenId = `intent-${nowMs}-${crypto.randomBytes(4).toString('hex')}`;

  const token = {
    tokenId,
    actorId,
    repoId,
    sourceIdsHash,
    targetId,
    compareHash,
    compareReceiptId,
    issuedAt,
    expiresAt,
    versionVector: receiptLookup.receipt.versionVector || null,
    versionVectorHash: normalizePlanningVersionVectorHash(receiptLookup.receipt.versionVector || null),
    consumedAt: null,
  };

  state.mergeIntentTokens.set(tokenId, token);

  return {
    statusCode: 200,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.merge-intent',
      deterministic: true,
      intentToken: token,
      ttlMs,
    },
  };
}

function executePlanningMerge(planningApiState, input = {}) {
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const state = reapPlanningMergeState(planningApiState, nowMs);

  const actorId = normalizeIdentity(context.userId || payload.actorId || payload.userId);
  const repoId = normalizeIdentity(context.repoId || payload.repoId);
  const tokenId = String(payload.tokenId || '').trim();
  const compareReceiptId = String(payload.compareReceiptId || '').trim();
  const targetId = String(payload.targetId || '').trim();
  const compareHash = String(payload.compareHash || '').trim();
  const sourceIdsHash = String(payload.sourceIdsHash || '').trim();

  if (!actorId) {
    return {
      statusCode: 403,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'scope_visibility_denied', reason: 'missing_user_context' },
      },
    };
  }

  if (!tokenId || !compareReceiptId || !targetId || !sourceIdsHash || !compareHash) {
    return {
      statusCode: 400,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'missing_merge_confirmation_fields' },
      },
    };
  }

  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  const existingIdempotencyRecord = idempotencyKey
    ? state.mergeIdempotencyRecords.get(idempotencyKey) || null
    : null;

  const idempotencyValidation = validatePlanningMergeIdempotency({
    idempotencyKey,
    actorId,
    targetId,
    sourceIdsHash,
    compareHash,
    operationType: 'merge',
  }, existingIdempotencyRecord);

  if (!idempotencyValidation.ok) {
    const statusCode = idempotencyValidation.error && idempotencyValidation.error.code === 'invalid_idempotency'
      ? 400
      : 409;
    return {
      statusCode,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: idempotencyValidation.error,
      },
    };
  }

  if (idempotencyValidation.replay && existingIdempotencyRecord && existingIdempotencyRecord.response) {
    return {
      statusCode: 200,
      body: {
        ...cloneJsonValue(existingIdempotencyRecord.response),
        idempotency: {
          key: idempotencyValidation.idempotencyKey,
          replay: true,
          scopeKey: idempotencyValidation.scopeKey,
          conflict: false,
          outcome: 'replay',
        },
      },
    };
  }

  const receiptLookup = resolvePlanningCompareReceipt(state, compareReceiptId, context, nowMs);
  if (!receiptLookup.ok) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: receiptLookup.error,
      },
    };
  }
  if (!receiptLookup.receipt.mergeEligible) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'merge_gate_blocked', reason: receiptLookup.receipt.reason || 'gate_not_pass' },
        gateState: receiptLookup.receipt.gateState,
        downgrade: receiptLookup.receipt.downgrade || null,
      },
    };
  }

  const token = state.mergeIntentTokens.get(tokenId);
  if (!token) {
    return {
      statusCode: 400,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'token_not_found' },
      },
    };
  }

  const tokenValidation = validatePlanningMergeConfirmationToken(token, {
    nowMs,
    actorId,
    targetId,
    compareHash,
  });

  if (!tokenValidation.ok) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: tokenValidation.error,
      },
    };
  }

  if (String(token.compareReceiptId || '') !== compareReceiptId) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'compare_receipt_mismatch' },
      },
    };
  }

  if (token.compareHash !== compareHash) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'compare_hash_mismatch' },
      },
    };
  }

  const sourceIds = normalizeMergeIdList(payload.sourceIds);
  const recomputedSourceIdsHash = buildPlanningSourceIdsHash(sourceIds);
  if (recomputedSourceIdsHash !== sourceIdsHash || token.sourceIdsHash !== sourceIdsHash) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'source_ids_hash_mismatch' },
      },
    };
  }

  const expectedVersionHash = normalizePlanningVersionVectorHash(payload.versionVector || null);
  const tokenVersionHash = String(token.versionVectorHash || normalizePlanningVersionVectorHash(token.versionVector || null));
  if (expectedVersionHash !== tokenVersionHash) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'snapshot_version_mismatch' },
      },
    };
  }

  const atomicEnvelope = payload.atomicEnvelope && typeof payload.atomicEnvelope === 'object'
    ? payload.atomicEnvelope
    : {
      targetUpdate: { targetId },
      sourceTransitions: sourceIds.map((sourceId) => ({ sourceId, toState: 'merged' })),
      lineageLinks: sourceIds.map((sourceId) => ({ from: sourceId, to: targetId })),
      auditEvent: {
        kind: 'planning_merge',
        actorId,
        compareHash,
        sourceIdsHash,
      },
      tokenConsumedWrite: { tokenId: token.tokenId },
    };

  const envelopeValidation = validatePlanningMergeAtomicEnvelope(atomicEnvelope);
  if (!envelopeValidation.ok) {
    return {
      statusCode: 400,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: envelopeValidation.error,
      },
    };
  }

  const winnerSummary = String(payload.conflictSummary || '').trim() || 'no precedence conflicts';
  const mergeScope = repoId ? 'repo' : 'user';

  const mergeRecordResult = createPlanningRecordOperation(state, {
    context: { userId: actorId, repoId },
    request: {
      idempotencyKey: `merge-record:${token.tokenId}`,
      scope: mergeScope,
      title: `Merge intent ${targetId}`,
      summary: `Intent ${token.tokenId}; compare=${compareHash}; conflicts=${winnerSummary}`,
      state: 'queued',
      score: 1,
    },
    nowMs,
  });

  if (!mergeRecordResult || mergeRecordResult.ok === false) {
    return {
      statusCode: 500,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'merge_commit_failed', reason: 'record_write_failed' },
      },
    };
  }

  token.consumedAt = new Date(nowMs).toISOString();
  state.mergeIntentTokens.set(token.tokenId, token);

  const response = {
    contractVersion: PLANNING_API_CONTRACT_VERSION,
    kind: 'planning.merge',
    deterministic: true,
    mergeAccepted: true,
    mergeEvent: {
      tokenId: token.tokenId,
      actorId,
      targetId,
      sourceIdsHash,
      compareHash,
      consumedAt: token.consumedAt,
      versionVector: token.versionVector || null,
    },
    mergeRecord: mergeRecordResult.body && mergeRecordResult.body.record ? mergeRecordResult.body.record : null,
  };

  state.mergeIdempotencyRecords.set(idempotencyValidation.idempotencyKey, {
    idempotencyKey: idempotencyValidation.idempotencyKey,
    payloadHash: idempotencyValidation.payloadHash,
    response: cloneJsonValue(response),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + PLANNING_MERGE_IDEMPOTENCY_TTL_MS,
  });

  return {
    statusCode: 200,
    body: {
      ...response,
      idempotency: {
        key: idempotencyValidation.idempotencyKey,
        replay: false,
        scopeKey: idempotencyValidation.scopeKey,
        conflict: false,
        outcome: 'applied',
      },
    },
  };
}

function rollbackMergeCommitAfterPersistenceFailure(planningApiState, operationBody = {}) {
  const mergeState = ensurePlanningMergeState(planningApiState);
  const body = operationBody && typeof operationBody === 'object' ? operationBody : {};

  const idempotency = body.idempotency && typeof body.idempotency === 'object'
    ? body.idempotency
    : null;
  const mergeEvent = body.mergeEvent && typeof body.mergeEvent === 'object'
    ? body.mergeEvent
    : null;

  const idempotencyKey = idempotency && typeof idempotency.key === 'string'
    ? idempotency.key.trim()
    : '';
  if (idempotencyKey) {
    mergeState.mergeIdempotencyRecords.delete(idempotencyKey);
  }

  const tokenId = mergeEvent && typeof mergeEvent.tokenId === 'string'
    ? mergeEvent.tokenId.trim()
    : '';
  if (tokenId) {
    const token = mergeState.mergeIntentTokens.get(tokenId);
    if (token && typeof token === 'object') {
      token.consumedAt = null;
      mergeState.mergeIntentTokens.set(tokenId, token);
    }
  }
}

function sendLifecyclePayloadError(res, action, failure) {
  sendJson(res, 400, {
    error: 'Invalid lifecycle payload',
    code: String(failure && failure.code ? failure.code : 'invalid_lifecycle_payload'),
    action,
    reason: String(failure && failure.reason ? failure.reason : 'validation_failed'),
  });
}

function resolveLifecycleCapabilityGate(action, providerState) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  const providerSelection = providerState && typeof providerState === 'object'
    ? (providerState.selectedProvider || providerState.defaultProvider)
    : null;

  const finishCompatibilityHook = buildFinishCompatibilityHookContract();

  if (normalizedAction === 'finish') {
    const providerCapability = evaluateProviderLifecycleCapability({
      provider: providerSelection,
      action: 'stop',
    });

    return {
      allowed: true,
      capability: {
        ...providerCapability,
        action: 'finish',
        shared: true,
        supported: true,
        marker: 'supported',
        reason: 'finish_sequence_supported',
        finishCompatibilityHook,
      },
      finishCompatibilityHook,
    };
  }

  const capability = evaluateProviderLifecycleCapability({
    provider: providerSelection,
    action: normalizedAction,
  });

  if (capability.supported) {
    return {
      allowed: true,
      capability,
      finishCompatibilityHook,
    };
  }

  return {
    allowed: false,
    statusCode: 501,
    capability,
    finishCompatibilityHook,
    body: {
      ...buildLifecycleUnsupportedCapabilityMarker({
      provider: capability.provider,
      action,
      }),
      finishCompatibilityHook,
    },
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.txt' || ext === '.md') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

const DESKTOP_UI_ACCESS_COOKIE = 'elegy_desktop_ui';
const DESKTOP_UI_ACCESS_HEADER = 'x-elegy-desktop-ui-token';
const DESKTOP_UI_ACCESS_QUERY_PARAM = 'desktop-ui-token';

function parseCookieHeader(cookieHeader) {
  const parsed = new Map();
  const raw = String(cookieHeader || '').trim();
  if (!raw) {
    return parsed;
  }

  for (const entry of raw.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    parsed.set(key, value);
  }

  return parsed;
}

function tokensMatch(expected, actual) {
  const expectedToken = String(expected || '').trim();
  const actualToken = String(actual || '').trim();
  if (!expectedToken || !actualToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken, 'utf8');
  const actualBuffer = Buffer.from(actualToken, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function buildDesktopUiAccessCookie(token) {
  return `${DESKTOP_UI_ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
}

function buildDesktopUiRedirectTarget(u) {
  const redirectUrl = new URL(u.pathname + u.search, 'http://127.0.0.1');
  redirectUrl.searchParams.delete(DESKTOP_UI_ACCESS_QUERY_PARAM);
  const search = redirectUrl.searchParams.toString();
  return `${redirectUrl.pathname}${search ? `?${search}` : ''}`;
}

function resolveDesktopUiAccess(req, u, desktopUiToken) {
  const expectedToken = String(desktopUiToken || '').trim();
  if (!expectedToken) {
    return { allowed: false, establishSession: false };
  }

  const cookieToken = parseCookieHeader(req.headers.cookie).get(DESKTOP_UI_ACCESS_COOKIE);
  if (tokensMatch(expectedToken, cookieToken)) {
    return { allowed: true, establishSession: false };
  }

  const headerToken = req.headers[DESKTOP_UI_ACCESS_HEADER];
  const requestToken = Array.isArray(headerToken)
    ? headerToken[0]
    : (u.searchParams.get(DESKTOP_UI_ACCESS_QUERY_PARAM) || headerToken || '');

  if (tokensMatch(expectedToken, requestToken)) {
    return { allowed: true, establishSession: true };
  }

  return { allowed: false, establishSession: false };
}

function denyDesktopUiAccess(res) {
  sendText(
    res,
    403,
    'Desktop UI access is restricted to the packaged desktop runtime. Start the desktop app for the dashboard, or use /api routes when running the raw server.'
  );
}

function serveStatic(staticDir, urlPath, res) {
  let rel = urlPath || '/';
  if (rel === '/') rel = '/index.html';
  rel = rel.split('\\').join('/');
  const cleaned = rel.replace(/^\/+/, '');
  const abs = safeResolveUnder(staticDir, cleaned);

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentTypeFor(abs),
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(abs).pipe(res);
}

function parseNumberQuery(searchParams, key, defaultValue) {
  const v = searchParams.get(key);
  if (v == null || v === '') return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  return n;
}

function resolveCodexHomeFromEnv(env) {
  const source = env && typeof env === 'object' ? env : process.env;
  return path.resolve(String(source.CODEX_HOME || path.join(os.homedir(), '.codex')));
}

function resolveCodexSkillsHomeFromEnv(env, codexHome) {
  const source = env && typeof env === 'object' ? env : process.env;
  return path.resolve(String(source.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME || path.join(codexHome, 'skills')));
}

function resolveGeminiHomeFromEnv(env) {
  const source = env && typeof env === 'object' ? env : process.env;
  return path.resolve(String(source.GEMINI_HOME || path.join(os.homedir(), '.gemini')));
}

function resolveAntigravityHomeFromEnv(env, geminiHome) {
  const source = env && typeof env === 'object' ? env : process.env;
  return path.resolve(String(source.INSTRUCTION_ENGINE_ANTIGRAVITY_HOME || path.join(geminiHome, 'antigravity')));
}

function resolveAntigravitySkillsHomeFromEnv(env, antigravityHome) {
  const source = env && typeof env === 'object' ? env : process.env;
  return path.resolve(String(source.INSTRUCTION_ENGINE_ANTIGRAVITY_SKILLS_HOME || path.join(antigravityHome, 'skills')));
}

function resolveOpenCodeHomeFromEnv(env) {
  const source = env && typeof env === 'object' ? env : process.env;
  if (source.OPENCODE_HOME) {
    return path.resolve(String(source.OPENCODE_HOME));
  }
  const configHome = source.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.resolve(path.join(configHome, 'opencode'));
}

function resolveOpenCodeSkillsHomeFromEnv(env, opencodeHome) {
  const source = env && typeof env === 'object' ? env : process.env;
  return path.resolve(String(source.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME || path.join(opencodeHome, 'skills')));
}

const policyPreflightCache = new Map();

function evaluatePolicyPreflight(engineRoot) {
  const validatorPath = path.join(path.resolve(engineRoot), 'scripts', 'validate-policy-lockfiles.js');
  const checkedAt = new Date().toISOString();

  if (!fs.existsSync(validatorPath)) {
    return {
      ok: false,
      status: 'unavailable',
      reason: 'validator_missing',
      checkedAt,
      validatorPath,
    };
  }

  const result = childProcess.spawnSync(process.execPath, [validatorPath], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 512 * 1024,
  });

  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();

  if (result.status === 0) {
    return {
      ok: true,
      status: 'passed',
      checkedAt,
      validatorPath,
      message: stdout || 'Policy lockfile validation passed',
    };
  }

  return {
    ok: false,
    status: 'failed',
    reason: 'validation_failed',
    checkedAt,
    validatorPath,
    exitCode: result.status,
    message: stderr || stdout || 'Policy lockfile validation failed',
  };
}

function getPolicyPreflight(engineRoot, { refresh = false } = {}) {
  const now = Date.now();
  const cacheKey = path.resolve(engineRoot);
  const cached = policyPreflightCache.get(cacheKey);
  if (!refresh && cached && cached.value && now < cached.expiresAtMs) {
    return cached.value;
  }

  const value = evaluatePolicyPreflight(cacheKey);
  policyPreflightCache.set(cacheKey, {
    value,
    expiresAtMs: now + 10_000,
  });

  return value;
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function looksLikePlanText(text) {
  const t = String(text || '');
  return (
    t.includes('# Plan Pack') ||
    t.includes('Plan Pack —') ||
    t.includes('# Plan-Pack Progress Tracker') ||
    t.includes('## Work Unit Specs')
  );
}

function extractPlanFromText(text) {
  const t = String(text || '');
  if (!looksLikePlanText(t)) return null;
  // Store/display the full blob; avoid brittle slicing/parsing.
  return t;
}

function readTextFileIfExists(absPath, maxBytes) {
  return assets.readTextFileSafe(absPath, maxBytes);
}

function listPlanArtifacts(sessionDirAbs) {
  const sessionDir = path.resolve(sessionDirAbs);
  const results = [];

  const planPath = path.join(sessionDir, 'plan.md');
  const finalPath = path.join(sessionDir, 'final.md');
  const plansDir = path.join(sessionDir, 'plans');
  const indexPath = path.join(plansDir, 'index.json');
  const metaPath = path.join(sessionDir, 'meta.json');

  const meta = readJsonFileSafe(metaPath);
  const sessionStatus = meta && typeof meta.status === 'string' ? meta.status : null;

  if (fs.existsSync(planPath) && fs.statSync(planPath).isFile()) {
    const st = fs.statSync(planPath);
    results.push({
      id: 'latest',
      kind: 'latest',
      status: null,
      source: 'plan.md',
      bytes: st.size,
      updatedMs: st.mtimeMs,
      sessionStatus,
    });
  }

  // Prefer an explicit plans index if present.
  const index = readJsonFileSafe(indexPath);
  if (index && typeof index === 'object' && !Array.isArray(index) && Array.isArray(index.plans)) {
    for (const p of index.plans) {
      if (!p || typeof p !== 'object') continue;
      const id = p.id;
      const file = p.file;
      if (typeof id !== 'string' || !id) continue;
      if (typeof file !== 'string' || !file) continue;
      const abs = path.join(plansDir, file);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const st = fs.statSync(abs);
      results.push({
        id,
        kind: 'revision',
        status: typeof p.status === 'string' ? p.status : null,
        verdict: typeof p.verdict === 'string' ? p.verdict : null,
        source: `plans/${file}`,
        bytes: st.size,
        updatedMs: st.mtimeMs,
        sessionStatus,
      });
    }
    return results;
  }

  // Fallback: list plans/*.md if present.
  try {
    if (fs.existsSync(plansDir) && fs.statSync(plansDir).isDirectory()) {
      const entries = fs.readdirSync(plansDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
        const abs = path.join(plansDir, e.name);
        const st = fs.statSync(abs);
        results.push({
          id: e.name.replace(/\.md$/i, ''),
          kind: 'revision',
          status: null,
          source: `plans/${e.name}`,
          bytes: st.size,
          updatedMs: st.mtimeMs,
          sessionStatus,
        });
      }
    }
  } catch {
    // ignore
  }

  // If no plan.md exists, offer a derived plan from final.md (display-only).
  if (!results.some((r) => r.id === 'latest')) {
    const finalText = readTextFileIfExists(finalPath, 2 * 1024 * 1024);
    const derived = finalText ? extractPlanFromText(finalText) : null;
    if (derived) {
      results.push({
        id: 'derived-from-final',
        kind: 'derived',
        status: sessionStatus && sessionStatus !== 'completed' ? 'dropped' : null,
        source: 'final.md',
        bytes: Buffer.byteLength(derived, 'utf8'),
        updatedMs: fs.existsSync(finalPath) ? fs.statSync(finalPath).mtimeMs : null,
        sessionStatus,
      });
    }
  }

  return results;
}

function readPlanArtifact(sessionDirAbs, planId) {
  const sessionDir = path.resolve(sessionDirAbs);
  const id = String(planId || '').trim();
  if (!id) return null;

  const planPath = path.join(sessionDir, 'plan.md');
  const finalPath = path.join(sessionDir, 'final.md');
  const plansDir = path.join(sessionDir, 'plans');

  if (id === 'latest') {
    return readTextFileIfExists(planPath, 2 * 1024 * 1024);
  }

  if (id === 'derived-from-final') {
    const finalText = readTextFileIfExists(finalPath, 2 * 1024 * 1024);
    return finalText ? extractPlanFromText(finalText) : null;
  }

  // revision id: map to plans/<id>.md
  const abs = path.join(plansDir, `${id}.md`);
  return readTextFileIfExists(abs, 2 * 1024 * 1024);
}

function writeTrackerProxyResponse(res, responsePlan) {
  res.writeHead(responsePlan.statusCode, responsePlan.headers);
  res.end(responsePlan.bodyText);
}

function proxyToTracker(trackerUrl, trackerToken, targetPath, method, req, res, lifecycleAction = null) {
  const parsed = new URL(targetPath, trackerUrl);
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: method,
    headers: {
      'Authorization': `Bearer ${trackerToken}`,
      'Accept': 'application/json',
      ...(lifecycleAction ? createLifecycleCompatibilityRequestHeaders() : {}),
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    if (lifecycleAction) {
      const compatibility = evaluateLifecycleMixedVersionCompatibility({
        action: lifecycleAction,
        direction: 'new_client_old_tracker',
        headers: proxyRes.headers,
      });
      if (!compatibility.compatible) {
        proxyRes.resume();
        sendJson(res, compatibility.statusCode, compatibility.body);
        return;
      }
    }

    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const responsePlan = buildTrackerProxyResponsePlan({
        statusCode: proxyRes.statusCode,
        headers: proxyRes.headers,
        bodyText: Buffer.concat(chunks).toString('utf8'),
      });
      writeTrackerProxyResponse(res, responsePlan);
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Tracker unreachable: ${err.message}` });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Tracker request timed out' });
    }
  });

  if (method === 'POST') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

function postJsonToTracker(trackerUrl, trackerToken, targetPath, payload, res, action = null) {
  const parsed = new URL(targetPath, trackerUrl);
  const rawBody = JSON.stringify(payload == null ? {} : payload);

  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${trackerToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(rawBody),
      ...createLifecycleCompatibilityRequestHeaders(),
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const compatibility = evaluateLifecycleMixedVersionCompatibility({
      action,
      direction: 'new_client_old_tracker',
      headers: proxyRes.headers,
    });
    if (!compatibility.compatible) {
      proxyRes.resume();
      sendJson(res, compatibility.statusCode, compatibility.body);
      return;
    }

    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const responsePlan = buildTrackerProxyResponsePlan({
        statusCode: proxyRes.statusCode,
        headers: proxyRes.headers,
        bodyText: Buffer.concat(chunks).toString('utf8'),
      });
      writeTrackerProxyResponse(res, responsePlan);
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Tracker unreachable: ${err.message}` });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Tracker request timed out' });
    }
  });

  proxyReq.write(rawBody);
  proxyReq.end();
}

function postJsonToTrackerWithFinishInvariant(trackerUrl, trackerToken, targetPath, payload, res, providerState, action = 'finish') {
  const parsed = new URL(targetPath, trackerUrl);
  const rawBody = JSON.stringify(payload == null ? {} : payload);

  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${trackerToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(rawBody),
      ...createLifecycleCompatibilityRequestHeaders(),
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const compatibility = evaluateLifecycleMixedVersionCompatibility({
      action,
      direction: 'new_client_old_tracker',
      headers: proxyRes.headers,
    });
    if (!compatibility.compatible) {
      proxyRes.resume();
      sendJson(res, compatibility.statusCode, compatibility.body);
      return;
    }

    const ct = String(proxyRes.headers['content-type'] || 'application/json');
    const statusCode = proxyRes.statusCode || 502;
    const chunks = [];

    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const responseBodyText = Buffer.concat(chunks).toString('utf8');
      if (statusCode >= 400) {
        const failureResponsePlan = buildTrackerProxyResponsePlan({
          statusCode,
          headers: proxyRes.headers,
          bodyText: responseBodyText,
        });
        writeTrackerProxyResponse(res, failureResponsePlan);
        return;
      }

      const isJson = ct.toLowerCase().includes('application/json');
      if (!isJson) {
        writeTrackerProxyResponse(res, {
          statusCode,
          headers: buildTrackerProxyPassThroughHeaders({
            ...proxyRes.headers,
            'content-type': ct,
          }),
          bodyText: responseBodyText,
        });
        return;
      }

      let parsedBody;
      try {
        parsedBody = responseBodyText.trim() ? JSON.parse(responseBodyText) : {};
      } catch {
        writeTrackerProxyResponse(res, {
          statusCode,
          headers: buildTrackerProxyPassThroughHeaders({
            ...proxyRes.headers,
            'content-type': ct,
          }),
          bodyText: responseBodyText,
        });
        return;
      }

      if (statusCode >= 200 && statusCode < 300) {
        const invariant = validateFinishCanonicalSandboxIdInvariant({
          canonicalSandboxId: payload && typeof payload.sandboxId === 'string' ? payload.sandboxId : '',
          prAction: payload && typeof payload.prAction === 'string' ? payload.prAction : 'skip-pr',
          trackerBody: parsedBody,
          providerState,
        });
        if (!invariant.ok) {
          sendJson(res, invariant.statusCode, invariant.body);
          return;
        }
      }

      sendJson(res, statusCode, parsedBody);
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Tracker unreachable: ${err.message}` });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Tracker request timed out' });
    }
  });

  proxyReq.write(rawBody);
  proxyReq.end();
}

function relayTrackerSSE(trackerUrl, trackerToken, req, res) {
  const parsed = new URL('/api/events', trackerUrl);
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${trackerToken}`,
      'Accept': 'text/event-stream',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      sendJson(res, 502, { error: `Tracker returned ${proxyRes.statusCode}` });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    proxyRes.pipe(res);

    req.on('close', () => {
      proxyReq.destroy();
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Tracker SSE unreachable: ${err.message}` });
    }
  });

  proxyReq.end();
}

function proxyToNativeRuntime(nativeRuntimeUrl, pathname, req, res) {
  const parsed = new URL(pathname, nativeRuntimeUrl);
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: {
      'Accept': 'application/json',
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      res.end(Buffer.concat(chunks));
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Native runtime unreachable: ${err.message}` });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Native runtime request timed out' });
    }
  });

  if (req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

function loadNativeRuntimeFallbackSessions(copilotHome) {
  try {
    const items = sessions.listSessions(copilotHome);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function normalizeProjectPathForMatch(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return '';
  const resolved = path.resolve(inputPath.trim());
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isActiveSessionStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'running';
}

function deriveFallbackDashboardHealth(sessionsList) {
  let health = 'ok';
  for (const session of sessionsList) {
    const status = String(session && session.status || '').trim().toLowerCase();
    if (status === 'error') return 'error';
    if (status === 'failed' || status === 'missing') {
      health = 'degraded';
    }
  }
  return health;
}

function buildFallbackDashboardSummary(sessionsList) {
  const sorted = sessionsList
    .slice()
    .sort((left, right) => {
      const leftTime = Number(left && (left.lastEventTime || left.startTime || 0)) || 0;
      const rightTime = Number(right && (right.lastEventTime || right.startTime || 0)) || 0;
      return rightTime - leftTime;
    });

  return {
    activeSessionCount: sessionsList.filter((session) => isActiveSessionStatus(session && session.status)).length,
    totalSessionCount: sessionsList.length,
    healthIndicator: deriveFallbackDashboardHealth(sessionsList),
    recentActivity: sorted.slice(0, 10).map((session) => ({
      type: 'session',
      timestamp: session && (session.lastEventTime || session.startTime || null),
      summary: `Session ${(session && (session.id || session.storageId)) || 'unknown'} [${(session && session.status) || 'unknown'}]`,
    })),
    source: 'server-fallback',
  };
}

function sessionMatchesProject(session, project) {
  if (!project || !session) return false;
  if (session.projectId && session.projectId === project.projectId) return true;
  if (session.repoId && session.repoId === project.repoId) return true;

  const projectPath = normalizeProjectPathForMatch(project.repoPath);
  const sessionRepoPath = normalizeProjectPathForMatch(session.repo);
  const sessionCwdPath = normalizeProjectPathForMatch(session.cwd);
  if (projectPath && (projectPath === sessionRepoPath || projectPath === sessionCwdPath)) {
    return true;
  }

  const repositoryFullName = session.repository && typeof session.repository === 'object'
    ? String(session.repository.fullName || '').trim().toLowerCase()
    : '';
  const canonicalRemote = String(project.canonicalRemote || '').trim().toLowerCase();
  return Boolean(repositoryFullName && canonicalRemote && repositoryFullName === canonicalRemote);
}

function buildFallbackProjects(copilotHome, sessionsList) {
  let state;
  try {
    state = repoInventoryService.loadRepoInventoryState(copilotHome);
  } catch {
    state = { manualRepos: [] };
  }

  const repos = Array.isArray(state && state.manualRepos) ? state.manualRepos : [];
  return repos.map((entry) => {
    const project = repoInventoryService.getProjectView(entry);
    const matchingSessions = sessionsList.filter((session) => sessionMatchesProject(session, project));
    return {
      ...project,
      sessionCount: matchingSessions.length,
      activeSessionCount: matchingSessions.filter((session) => isActiveSessionStatus(session && session.status)).length,
    };
  });
}

function decodeProjectId(pathSegment) {
  try {
    return decodeURIComponent(String(pathSegment || '')).trim();
  } catch {
    return String(pathSegment || '').trim();
  }
}

function buildFallbackProjectActivity(sessionsList, limit = 20) {
  return sessionsList
    .map((session) => ({
      type: 'session',
      timestamp: session && (session.lastEventTime || session.startTime || null),
      summary: `Session ${(session && (session.id || session.storageId)) || 'unknown'} [${(session && session.status) || 'unknown'}]`,
    }))
    .sort((left, right) => (Number(right.timestamp || 0) - Number(left.timestamp || 0)))
    .slice(0, limit);
}

function handleNativeRuntimeFallback({ req, res, pathname, copilotHome }) {
  const method = String(req.method || 'GET').toUpperCase();
  const sessionsList = loadNativeRuntimeFallbackSessions(copilotHome);

  if (pathname === '/api/dashboard/summary' && method === 'GET') {
    sendJson(res, 200, buildFallbackDashboardSummary(sessionsList));
    return true;
  }

  if (pathname === '/api/projects' && method === 'GET') {
    sendJson(res, 200, buildFallbackProjects(copilotHome, sessionsList));
    return true;
  }

  const projectRootMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectRootMatch && method === 'PATCH') {
    const projectId = decodeProjectId(projectRootMatch[1]);
    if (!projectId) {
      sendJson(res, 400, { error: 'missing_project_id', message: 'Project ID is required.' });
      return true;
    }

    readJsonBody(req)
      .then((payload) => {
        const updated = repoInventoryService.updateProjectFields(copilotHome, projectId, payload || {});
        if (!updated) {
          sendJson(res, 404, { error: 'project_not_found', message: `Project ${projectId} was not found.` });
          return;
        }

        const project = repoInventoryService.getProjectView(updated);
        const matchingSessions = sessionsList.filter((session) => sessionMatchesProject(session, project));
        sendJson(res, 200, {
          ...project,
          sessionCount: matchingSessions.length,
          activeSessionCount: matchingSessions.filter((session) => isActiveSessionStatus(session && session.status)).length,
        });
      })
      .catch((error) => {
        sendJson(res, Number(error && error.statusCode) || 400, {
          error: 'invalid_project_update_payload',
          message: String(error && error.message || error),
        });
      });

    return true;
  }

  const projectSessionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
  if (projectSessionsMatch && method === 'GET') {
    const projectId = decodeProjectId(projectSessionsMatch[1]);
    const project = buildFallbackProjects(copilotHome, sessionsList).find((entry) => entry.projectId === projectId) || null;
    const matchingSessions = sessionsList.filter((session) => {
      if (sessionMatchesProject(session, project)) return true;
      return session && (session.projectId === projectId || session.repoId === projectId || session.repo === projectId);
    });
    sendJson(res, 200, matchingSessions);
    return true;
  }

  const projectActivityMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activity$/);
  if (projectActivityMatch && method === 'GET') {
    const projectId = decodeProjectId(projectActivityMatch[1]);
    const project = buildFallbackProjects(copilotHome, sessionsList).find((entry) => entry.projectId === projectId) || null;
    const matchingSessions = sessionsList.filter((session) => {
      if (sessionMatchesProject(session, project)) return true;
      return session && (session.projectId === projectId || session.repoId === projectId || session.repo === projectId);
    });
    sendJson(res, 200, buildFallbackProjectActivity(matchingSessions));
    return true;
  }

  return false;
}

function handleApi({ req, res, u, copilotHome, vscodeHome, sandboxesHome, engineRoot, changeTracker, trackerUrl, trackerToken, planningPersistenceConfig, planningPersistenceState, planningApiState, planningAuthContext, providerState, planningDurabilityDependencyGate, startupManagedAssetSync, autonomousDecisionLog, routeRegistry, nativeRuntimeUrl }) {
  // Auth scope: single-session only. Multi-session aggregate views are deferred.
  // All API endpoints serve one session at a time. No cross-session auth tokens.
  const pathname = u.pathname;
  const copilotHomeAbs = path.resolve(copilotHome);
  const vscodeHomeAbs = path.resolve(vscodeHome);
  const codexHome = resolveCodexHomeFromEnv(process.env);
  const codexSkillsHome = resolveCodexSkillsHomeFromEnv(process.env, codexHome);
  const geminiHome = resolveGeminiHomeFromEnv(process.env);
  const antigravityHome = resolveAntigravityHomeFromEnv(process.env, geminiHome);
  const antigravitySkillsHome = resolveAntigravitySkillsHomeFromEnv(process.env, antigravityHome);
  const opencodeHome = resolveOpenCodeHomeFromEnv(process.env);
  const opencodeSkillsHome = resolveOpenCodeSkillsHomeFromEnv(process.env, opencodeHome);
  const activePlanningDurabilityDependencyGate = planningDurabilityDependencyGate
    && typeof planningDurabilityDependencyGate === 'object'
    ? planningDurabilityDependencyGate
    : evaluatePlanningDurabilityDependencyGate({ env: process.env });

  const isMutatingRequest = req.method && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
  if (isMutatingRequest) {
    const policy = getPolicyPreflight(engineRoot);
    if (!policy.ok) {
      sendJson(res, 503, {
        error: 'Policy gate blocked mutating request',
        code: 'policy_gate_blocked',
        policy,
      });
      return;
    }
  }

  if (isPlanningDurabilityRoute(pathname) && activePlanningDurabilityDependencyGate.ready !== true) {
    const gateFailure = buildPlanningDurabilityDependencyGateFailure(pathname, req.method, activePlanningDurabilityDependencyGate);
    sendJson(res, gateFailure.statusCode, gateFailure.body);
    return;
  }

  if (isPlanningDurabilityCriticalRoute(pathname)) {
    const durabilityRouteGate = resolvePlanningDurabilityRouteGateState(
      pathname,
      req.method,
      planningPersistenceConfig,
      planningPersistenceState,
    );

    if (durabilityRouteGate.required && durabilityRouteGate.ready !== true) {
      const gateFailure = buildPlanningDurabilityRouteGateFailure(pathname, req.method, durabilityRouteGate);
      sendJson(res, gateFailure.statusCode, gateFailure.body);
      return;
    }
  }

  if (
    pathname.startsWith('/api/projects') ||
    pathname === '/api/dashboard/summary'
  ) {
    if (!nativeRuntimeUrl && handleNativeRuntimeFallback({ req, res, pathname, copilotHome: copilotHomeAbs })) {
      return;
    }

    if (!nativeRuntimeUrl) {
      sendJson(res, 503, {
        error: 'Native runtime required',
        code: 'native_runtime_unavailable',
        message: `The ${pathname} endpoint requires the Rust native runtime, which is not configured. Set INSTRUCTION_ENGINE_NATIVE_RUNTIME_URL or ELEGY_NATIVE_RUNTIME_URL.`,
      });
      return;
    }

    proxyToNativeRuntime(nativeRuntimeUrl, pathname, req, res);
    return;
  }

  if (nativeRuntimeUrl && (
    pathname === '/api/health' ||
    pathname === '/api/version' ||
    pathname === '/api/policy/preflight'
  )) {
    proxyToNativeRuntime(nativeRuntimeUrl, pathname, req, res);
    return;
  }

  const retiredRepoFilePlanningSurface = resolveRetiredRepoFilePlanningSurface(pathname, req.method);
  if (retiredRepoFilePlanningSurface) {
    sendJson(
      res,
      410,
      buildRetiredRepoFilePlanningSurfaceResponse(
        retiredRepoFilePlanningSurface.kind,
        retiredRepoFilePlanningSurface.surfaceLabel,
      ),
    );
    return;
  }

  if (routeRegistry && routeRegistry.dispatch({
    req,
    res,
    u,
    pathname,
    engineRoot,
    copilotHome,
    vscodeHome,
    sandboxesHome,
    changeTracker,
    copilotHomeAbs,
    vscodeHomeAbs,
    codexHome,
    codexSkillsHome,
    geminiHome,
    antigravityHome,
    antigravitySkillsHome,
    opencodeHome,
    opencodeSkillsHome,
    planningDurabilityDependencyGate: activePlanningDurabilityDependencyGate,
    activePlanningDurabilityDependencyGate,
    planningPersistenceConfig,
    planningPersistenceState,
    planningApiState,
    planningAuthContext,
    providerState,
    startupManagedAssetSync,
    autonomousDecisionLog,
  })) {
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function isSdkBridgeEnabled(env) {
  const source = env && typeof env === 'object' ? env : process.env;
  return String(source.COPILOT_SDK_BRIDGE || '').trim() === '1';
}

async function initializeSdkBridge({ engineRoot, copilotHome, env, policyPreflightFn }) {
  const sourceEnv = env && typeof env === 'object' ? env : process.env;
  if (!isSdkBridgeEnabled(sourceEnv)) {
    return null;
  }

  const bridgeModulePath = pathToFileURL(path.join(__dirname, 'lib', 'copilot-bridge', 'index.mjs')).href;
  const bridgeModule = await import(bridgeModulePath);

  if (!bridgeModule || typeof bridgeModule.SdkBridgeService !== 'function') {
    throw new Error('SdkBridgeService export not found in copilot bridge module');
  }

  if (typeof bridgeModule.resolveBridgeConfig !== 'function') {
    throw new Error('resolveBridgeConfig export not found in copilot bridge module');
  }

  const bridgeConfig = bridgeModule.resolveBridgeConfig(sourceEnv, {
    enabled: true,
    cwd: engineRoot,
    copilotHome,
    policyPreflightFn,
  });

  const sdkBridge = new bridgeModule.SdkBridgeService(bridgeConfig);
  await sdkBridge.init();
  return sdkBridge;
}

async function shutdownSdkBridgeSafely(sdkBridge) {
  if (!sdkBridge || typeof sdkBridge.shutdown !== 'function') {
    return;
  }

  try {
    await sdkBridge.shutdown();
  } catch {
    // Best-effort shutdown on server close/error.
  }
}

async function shutdownExecutorServiceSafely(executorService) {
  if (!executorService || typeof executorService.shutdown !== 'function') {
    return;
  }

  try {
    await executorService.shutdown();
  } catch {
    // Best-effort shutdown on server close/error.
  }
}

async function shutdownWorkflowLayerServiceSafely(workflowLayerService) {
  if (!workflowLayerService || typeof workflowLayerService.shutdown !== 'function') {
    return;
  }

  try {
    await workflowLayerService.shutdown();
  } catch {
    // Best-effort shutdown on server close/error.
  }
}

async function closePlanningPersistenceClientSafely(client) {
  if (!client || typeof client.close !== 'function') {
    return;
  }

  try {
    await client.close();
  } catch {
    // Best-effort shutdown on server close/error.
  }
}

async function startServer(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const args = {
    port: Number.isFinite(options.port) ? Number(options.port) : 3210,
    host: typeof options.host === 'string' && options.host.trim() ? options.host.trim() : '127.0.0.1',
    token: typeof options.token === 'string' && options.token.trim() ? options.token.trim() : null,
    desktopUiToken: typeof options.desktopUiToken === 'string' && options.desktopUiToken.trim() ? options.desktopUiToken.trim() : null,
    copilotHome: typeof options.copilotHome === 'string' && options.copilotHome.trim() ? options.copilotHome.trim() : null,
    vscodeHome: typeof options.vscodeHome === 'string' && options.vscodeHome.trim() ? options.vscodeHome.trim() : null,
    sandboxesHome: typeof options.sandboxesHome === 'string' && options.sandboxesHome.trim() ? options.sandboxesHome.trim() : null,
    trackerUrl: typeof options.trackerUrl === 'string' && options.trackerUrl.trim() ? options.trackerUrl.trim() : null,
    trackerToken: typeof options.trackerToken === 'string' && options.trackerToken.trim() ? options.trackerToken.trim() : null,
    workflowSidecarManager: options.workflowSidecarManager && typeof options.workflowSidecarManager === 'object'
      ? options.workflowSidecarManager
      : null,
  };

  const quiet = options.quiet === true;
  const nativeRuntimeUrl = typeof options.nativeRuntimeUrl === 'string' && options.nativeRuntimeUrl.trim()
    ? options.nativeRuntimeUrl.trim()
    : (String(env.INSTRUCTION_ENGINE_NATIVE_RUNTIME_URL || env.ELEGY_NATIVE_RUNTIME_URL || '').trim() || null);
  const managedAssetSyncOnStart = options.managedAssetSyncOnStart !== false
    && String(env.INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC || '').trim() !== '1';
  const engineRoot =
    typeof options.engineRoot === 'string' && options.engineRoot.trim()
      ? path.resolve(options.engineRoot.trim())
      : path.resolve(__dirname, '..');
  const logger = quiet ? () => {} : (message) => console.log(message);
  const copilotHome = resolveCopilotHome(args);
  const vscodeHome = resolveVscodeHome(args);
  const sandboxesHome = resolveSandboxesHome(args);
  const autonomousDecisionLog = createAutonomousDecisionLog(copilotHome);
  const trackerUrl = resolveTrackerUrl(args);
  const trackerTokenResolution = await resolveTrackerToken(args);
  const trackerToken = trackerTokenResolution.value;
  const planningPersistenceConfig = readPlanningPersistenceConfig(env);
  const planningValidation = validatePlanningPersistenceConfig(planningPersistenceConfig);
  const planningDurabilityDependencyGate = evaluatePlanningDurabilityDependencyGate({ env });
  const providerState = readPlanningProviderState({
    persistedState: options.providerState,
    env,
  });
  const canonicalProviderState = buildPlanningProviderStatePersistencePayload(providerState);
  const planningPersistenceState = {
    validation: planningValidation,
    status: planningValidation.usable ? 'ready' : planningValidation.configured ? 'invalid_config' : 'disabled',
    lastError: null,
    client: null,
    providerState: {
      ...canonicalProviderState,
      migration: providerState.migration,
    },
    migrations: {
      appliedCount: 0,
      appliedVersions: [],
      driftDetected: false,
      lastRunAt: null,
    },
    corruption: {
      contractVersion: '1',
      scannedAt: null,
      blocked: false,
      recoveryRequired: false,
      findingCount: 0,
      code: 'planning_persistence_corruption_not_scanned',
      reason: 'corruption_scan_not_run',
    },
  };
  const planningApiState = createPlanningApiState();
  const createPlanningPersistenceClient = typeof options.createPlanningPersistenceClient === 'function'
    ? options.createPlanningPersistenceClient
    : ({ connectionString }) => createPostgresPlanningPersistenceClient({ connectionString });
  let ownedPlanningPersistenceClient = null;

  if (planningValidation.required && !planningValidation.usable) {
    const detail = planningValidation.errors.length
      ? planningValidation.errors.join(',')
      : planningValidation.status;
    throw new Error(`Planning persistence is required but configuration is invalid: ${detail}`);
  }

  if (planningValidation.usable) {
    let planningPersistenceClient = options.planningPersistenceClient;
    if ((!planningPersistenceClient || typeof planningPersistenceClient.query !== 'function') && planningPersistenceConfig.databaseUrl) {
      try {
        ownedPlanningPersistenceClient = createPlanningPersistenceClient({
          connectionString: planningPersistenceConfig.databaseUrl,
        });
        planningPersistenceClient = ownedPlanningPersistenceClient;
      } catch (error) {
        planningPersistenceState.status = 'configured_no_client';
        planningPersistenceState.lastError = String(error && error.message ? error.message : error);
        planningPersistenceState.client = null;

        if (planningValidation.required) {
          await closePlanningPersistenceClientSafely(ownedPlanningPersistenceClient);
          throw new Error(`Planning persistence client startup failed: ${planningPersistenceState.lastError}`);
        }
      }
    }

    if (!planningPersistenceClient || typeof planningPersistenceClient.query !== 'function') {
      planningPersistenceState.status = 'configured_no_client';
      planningPersistenceState.lastError = 'planning_persistence_client_unavailable';
      planningPersistenceState.client = null;

      if (planningValidation.required) {
        throw new Error('Planning persistence is required but no planning persistence client was provided');
      }
    } else {
      try {
        const migrationResult = await runPlanningMigrations(planningPersistenceClient, {
          schemaTable: planningPersistenceConfig.schemaTable,
        });
        planningPersistenceState.status = 'ready';
        planningPersistenceState.client = planningPersistenceClient;
        planningPersistenceState.migrations = {
          ...migrationResult,
          lastRunAt: new Date().toISOString(),
        };

        const corruptionScan = await scanPlanningPersistenceCorruption(planningPersistenceClient);
        applyPlanningPersistenceCorruptionScan(planningPersistenceState, corruptionScan);
      } catch (error) {
        const isChecksumDrift = error && error.code === 'PLANNING_MIGRATION_CHECKSUM_DRIFT';
        const isBaselineMismatch = error && error.code === 'PLANNING_MIGRATION_BASELINE_MISMATCH';

        planningPersistenceState.status = isChecksumDrift || isBaselineMismatch
          ? 'drift_detected'
          : 'migration_error';
        planningPersistenceState.lastError = String(error && error.message ? error.message : error);
        planningPersistenceState.client = planningPersistenceClient;
        planningPersistenceState.migrations = {
          ...planningPersistenceState.migrations,
          driftDetected: isChecksumDrift || isBaselineMismatch,
          baselineMismatch: isBaselineMismatch,
          checksumValidation: error && error.checksumValidation
            ? error.checksumValidation
            : null,
          lastRunAt: new Date().toISOString(),
        };

        if (planningValidation.required) {
          await closePlanningPersistenceClientSafely(ownedPlanningPersistenceClient);
          throw error;
        }
      }
    }
  }

  const changeTracker = createChangeTracker(path.resolve(copilotHome), path.resolve(vscodeHome), path.resolve(sandboxesHome));
  const uiDistDir = path.join(__dirname, 'ui-dist');
  const legacyPublicDir = path.join(__dirname, 'public');
  const resolveStaticDir = () => (fs.existsSync(path.join(uiDistDir, 'index.html'))
    ? uiDistDir
    : legacyPublicDir);
  const host = args.host;
  const token = resolveToken(args, host);
  const planningAuthContext = {
    userId: derivePlanningActorId(token),
  };
  const startupManagedAssetSyncRunAt = new Date().toISOString();
  const managedAssetSyncSummary = managedAssetSyncOnStart
    ? runStartupManagedAssetSync(engineRoot, [copilotHome, vscodeHome], {
      pointerMode: true,
      quiet,
    })
    : [];
  let startupManagedAssetSync = summarizeStartupManagedAssetSync(managedAssetSyncSummary, {
    ran: managedAssetSyncOnStart,
    lastRunAt: startupManagedAssetSyncRunAt,
  });
  const startupManagedAssetSyncDecision = autonomousDecisionLog.record(
    buildStartupManagedAssetSyncDecisionEvent(startupManagedAssetSync),
  );
  startupManagedAssetSync = {
    ...startupManagedAssetSync,
    decisionLogged: startupManagedAssetSyncDecision.ok,
    decisionEventId: startupManagedAssetSyncDecision.ok ? startupManagedAssetSyncDecision.event.id : null,
    decisionLoggedAt: startupManagedAssetSyncDecision.ok ? startupManagedAssetSyncDecision.event.occurredAt : null,
    decisionLogError: startupManagedAssetSyncDecision.ok ? null : startupManagedAssetSyncDecision.error,
  };
  const bundledRollbackPolicyJson = readDefaultDesktopRollbackPolicy(engineRoot, logger);
  const desktopUpdaterController = options.desktopUpdaterController || createDesktopUpdaterController({
    appVersion: String(env.ELEGY_TAURI_APP_VERSION || copilotUiPackageJson.version || 'unknown').trim() || 'unknown',
    explicitChannel: env.INSTRUCTION_ENGINE_UPDATE_CHANNEL || null,
    rollbackPolicyJson: env.INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON,
    defaultRollbackPolicyJson: bundledRollbackPolicyJson,
    disableUpdates: env.INSTRUCTION_ENGINE_DISABLE_UPDATES,
    publishRepository: copilotUiPackageJson.desktopRelease && copilotUiPackageJson.desktopRelease.publishRepository,
    downloadRoot: path.join(copilotHome, 'desktop-updater'),
    fetch: options.fetch,
    logger,
    platform: process.platform,
  });
  const desktopUpdaterAutoCheckIntervalMs = Number.isFinite(options.desktopUpdaterAutoCheckIntervalMs)
    && Number(options.desktopUpdaterAutoCheckIntervalMs) > 0
    ? Number(options.desktopUpdaterAutoCheckIntervalMs)
    : 15 * 60 * 1000;
  let desktopUpdaterAutoCheckTimer = null;
  function stopDesktopUpdaterBackgroundWork() {
    if (desktopUpdaterAutoCheckTimer) {
      clearInterval(desktopUpdaterAutoCheckTimer);
      desktopUpdaterAutoCheckTimer = null;
    }
    if (desktopUpdaterController && typeof desktopUpdaterController.close === 'function') {
      desktopUpdaterController.close();
    }
  }
  const sdkBridgeEnabled = isSdkBridgeEnabled(env);
  let sdkBridge = null;
  let executorService = null;
  let workflowLayerService = null;

  if (sdkBridgeEnabled) {
    try {
        sdkBridge = await initializeSdkBridge({
          engineRoot,
          copilotHome,
          env,
          policyPreflightFn: () => getPolicyPreflight(engineRoot),
        });
    } catch (error) {
      stopDesktopUpdaterBackgroundWork();
      changeTracker.close();
      const detail = String(error && error.message ? error.message : error);
      throw new Error(`SDK bridge startup failed with COPILOT_SDK_BRIDGE=1: ${detail}`);
    }
  }

  try {
    executorService = await createExecutorService({
      copilotHome,
      sdkBridge,
    }).init();
  } catch (error) {
    stopDesktopUpdaterBackgroundWork();
    await shutdownSdkBridgeSafely(sdkBridge);
    changeTracker.close();
    await closePlanningPersistenceClientSafely(ownedPlanningPersistenceClient);
    const detail = String(error && error.message ? error.message : error);
    throw new Error(`Executor service startup failed: ${detail}`);
  }

  try {
    workflowLayerService = await createWorkflowLayerService({
      copilotHome,
      executorService,
      workflowSidecarManager: args.workflowSidecarManager,
    }).init();
  } catch (error) {
    stopDesktopUpdaterBackgroundWork();
    await shutdownExecutorServiceSafely(executorService);
    await shutdownSdkBridgeSafely(sdkBridge);
    changeTracker.close();
    await closePlanningPersistenceClientSafely(ownedPlanningPersistenceClient);
    const detail = String(error && error.message ? error.message : error);
    throw new Error(`Workflow layer startup failed: ${detail}`);
  }

  const uiRuntimeOverlayService = createUiRuntimeOverlayService({
    copilotHome,
    engineRoot,
  });
  const roadmapWorkflowMemoryBridge = Object.prototype.hasOwnProperty.call(options, 'roadmapWorkflowMemoryBridge')
    ? options.roadmapWorkflowMemoryBridge
    : createRoadmapWorkflowMemoryBridge({
      copilotHome,
      childProcess: options.childProcess || childProcess,
      env,
    });

  if (!resolveElegyPlanningCliPath({
    cliPath: env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
    runtimeRoot: engineRoot,
    copilotHome,
  })) {
    try {
      logger('elegy-planning CLI not found locally, attempting download from GitHub releases...');
      const downloadedPath = await downloadElegyPlanningCli({ copilotHome, logger });
      env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH = downloadedPath;
      logger(`elegy-planning CLI downloaded to: ${downloadedPath}`);
    } catch (downloadError) {
      logger(`elegy-planning CLI download failed: ${downloadError.message}`);
    }
  }

  const roadmapWorkflowPlanningBridge = Object.prototype.hasOwnProperty.call(options, 'roadmapWorkflowPlanningBridge')
    ? options.roadmapWorkflowPlanningBridge
    : createRoadmapWorkflowPlanningBridge({
      enabled: true,
      copilotHome,
      runtimeRoot: engineRoot,
      childProcess: options.childProcess || childProcess,
      env,
    });

  let routeRegistry;
  try {
    routeRegistry = createRegistry({
      fs,
      path,
      os,
      process,
      childProcess,
      sessions,
      assets,
      engineRoot,
      getPolicyPreflight,
      getRuntimeHealth,
      trackerUrl,
      trackerToken,
      proxyToTracker,
      postJsonToTracker,
      postJsonToTrackerWithFinishInvariant,
      relayTrackerSSE,
      resolveLifecycleCapabilityGate,
      validateOpenTerminalLifecyclePayload,
      validateFinishLifecyclePayload,
      sendLifecyclePayloadError,
      planState,
      sendJson,
      sendText,
      readJsonBody,
      safeResolveUnder,
      extractTriggers,
      parseNumberQuery,
      resolveSessionsHome,
      isValidSessionId,
      ensureDir,
      resolveMessagingGatewayConfigPath,
      readJsonFileSafe,
      resolvePlanningPersistenceAuthorityState,
      resolvePlanningLiveAuthorityState,
      probeTrackerReadiness,
      buildGatewayStateEnvelope,
      buildGatewayProbeFailure,
      uniqueArchiveDir,
      listPlanArtifacts,
      readPlanArtifact,
      initializePlanningPersistenceAuthority,
      PLANNING_API_CONTRACT_VERSION,
      buildPlanningPersistenceHealthEnvelope,
      getPlanningPersistenceHealth,
      resolvePlanningPersistenceOperationClient,
      scanPlanningPersistenceCorruption,
      applyPlanningPersistenceCorruptionScan,
      runPlanningRetention,
      buildPlanningPersistenceWriteBlockedFailure,
      buildPlanningPersistenceCorruptionEnvelope,
      exportPlanningPersistenceSnapshot,
      importPlanningPersistenceSnapshot,
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
      parsePlanningScopesFromRequest,
      listPlanningRecordsOperation,
      firstStringValue,
      searchPlanningRecordsOperation,
      comparePlanningRecordsOperation,
      recordPlanningCompareReceipt,
      resolvePlanningDurabilityWriteAuthority,
      persistPlanningCompareReceipt,
      buildPlanningDurabilityPersistenceFailure,
      issuePlanningMergeIntent,
      persistPlanningMergeIntent,
      hydratePlanningMergeDurabilityStateFromAuthority,
      executePlanningMerge,
      rollbackMergeCommitAfterPersistenceFailure,
      persistPlanningMergeCommitDurabilityArtifacts,
      compensatePlanningMergeDurabilityFailure,
      persistPlanningSuggestion,
      resolvePlanningDurabilityArtifactErrorStatusCode,
      buildPlanningDurabilityArtifactFailureEnvelope,
      readPlanningSuggestion,
      persistPlanningRecap,
      readPlanningRecap,
      persistRoadmapWorkflowArtifact,
      roadmapWorkflowPlanningBridge,
      roadmapWorkflowMemoryBridge,
      readRoadmapWorkflowArtifact,
      listRoadmapWorkflowArtifacts,
      desktopUpdaterController,
      sdkBridge,
      executorService,
      workflowLayerService,
      uiRuntimeOverlayService,
    });
  } catch (error) {
    stopDesktopUpdaterBackgroundWork();
    await shutdownWorkflowLayerServiceSafely(workflowLayerService);
    await shutdownExecutorServiceSafely(executorService);
    await shutdownSdkBridgeSafely(sdkBridge);
    changeTracker.close();
    await closePlanningPersistenceClientSafely(ownedPlanningPersistenceClient);
    throw error;
  }

  const server = http.createServer((req, res) => {
    if (!checkAuth(req, token, { allowLoopbackBypass: !isNonLoopback(host) })) {
      res.writeHead(401);
      res.end();
      return;
    }
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (u.pathname.startsWith('/api/')) {
        handleApi({
          req,
          res,
          u,
          copilotHome,
          vscodeHome,
          sandboxesHome,
          engineRoot,
          changeTracker,
          trackerUrl,
          trackerToken,
          planningPersistenceConfig,
          planningPersistenceState,
          planningApiState,
          planningAuthContext,
          providerState: planningPersistenceState.providerState,
          planningDurabilityDependencyGate,
          startupManagedAssetSync,
          autonomousDecisionLog,
          routeRegistry,
          nativeRuntimeUrl,
        });
        return;
      }

      const desktopUiAccess = resolveDesktopUiAccess(req, u, args.desktopUiToken);
      if (!desktopUiAccess.allowed) {
        denyDesktopUiAccess(res);
        return;
      }

      if (desktopUiAccess.establishSession) {
        res.writeHead(302, {
          'Location': buildDesktopUiRedirectTarget(u),
          'Set-Cookie': buildDesktopUiAccessCookie(args.desktopUiToken),
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      serveStatic(resolveStaticDir(), u.pathname, res);
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) });
    }
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    server.once('error', (error) => {
      if (settled) return;
      settled = true;
      Promise.resolve()
        .then(() => stopDesktopUpdaterBackgroundWork())
        .then(() => shutdownWorkflowLayerServiceSafely(workflowLayerService))
        .then(() => shutdownExecutorServiceSafely(executorService))
        .then(() => shutdownSdkBridgeSafely(sdkBridge))
        .then(() => closePlanningPersistenceClientSafely(ownedPlanningPersistenceClient))
        .finally(() => {
          changeTracker.close();
          reject(error);
        });
    });

    server.listen(args.port, host, () => {
      if (settled) return;
      settled = true;
      const addr = server.address();
      const actualPort = addr && typeof addr === 'object' ? addr.port : args.port;
      if (!quiet) {
        console.log(`CLI UI server: http://${host}:${actualPort}/`);
        console.log(`copilotHome:    ${copilotHome}`);
        console.log(`vscodeHome:     ${vscodeHome}`);
        console.log(`sandboxesHome:  ${sandboxesHome}`);
        console.log(`engineRoot:     ${engineRoot}`);
        console.log(`trackerUrl:     ${trackerUrl}`);
        if (sdkBridgeEnabled) console.log('sdkBridge:      enabled');
        if (trackerToken) console.log(`trackerAuth:    configured (${trackerTokenResolution.source})`);
        if (token) {
          console.log('auth token:     configured (redacted)');
        }
        if (isNonLoopback(host)) {
          console.error('[WARN] Binding to non-loopback address without HTTPS. Auth token is transmitted in cleartext.');
          console.error('[WARN] Use a reverse proxy with TLS termination for production use.');
        }
      }

      void desktopUpdaterController.checkForUpdates().catch((error) => {
        if (!quiet) {
          console.warn(`[desktop-updater] startup check failed: ${String(error && error.message ? error.message : error)}`);
        }
      });
      desktopUpdaterAutoCheckTimer = setInterval(() => {
        void desktopUpdaterController.checkForUpdates().catch((error) => {
          if (!quiet) {
            console.warn(`[desktop-updater] background check failed: ${String(error && error.message ? error.message : error)}`);
          }
        });
      }, desktopUpdaterAutoCheckIntervalMs);

      resolve({
        server,
        routeRegistry,
        host,
        port: actualPort,
        token,
        copilotHome,
        vscodeHome,
        sandboxesHome,
        trackerUrl,
        managedAssetSyncSummary,
        startupManagedAssetSync,
        autonomousDecisionLog: autonomousDecisionLog.getSummary(),
        close: () => new Promise((closeResolve) => {
          Promise.resolve()
            .then(() => stopDesktopUpdaterBackgroundWork())
            .then(() => shutdownWorkflowLayerServiceSafely(workflowLayerService))
            .then(() => shutdownExecutorServiceSafely(executorService))
            .then(() => shutdownSdkBridgeSafely(sdkBridge))
            .then(() => closePlanningPersistenceClientSafely(ownedPlanningPersistenceClient))
            .finally(() => {
              changeTracker.close();
              server.close(() => closeResolve());
            });
        }),
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node copilot-ui/server.js [--port 3210] [--host 127.0.0.1] [--token <token>] [--copilot-home <path>] [--tracker-url <url>] [--tracker-token <token>]');
    process.exit(0);
  }

  await startServer(args);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}

module.exports = {
  startServer,
  readDefaultDesktopRollbackPolicy,
  resolveRetiredRepoFilePlanningSurface,
  parseArgs,
  probeTrackerReadiness,
  containsUnsafeShellSyntax,
  validateOpenTerminalLifecyclePayload,
  validateFinishLifecyclePayload,
  validateFinishCanonicalSandboxIdInvariant,
  canReadPlanningRecord,
  canWritePlanningRecord,
  filterPlanningRecordsForCompare,
  validatePlanningMergeConfirmationToken,
  validatePlanningMergeIdempotency,
  validatePlanningMergeAtomicEnvelope,
  deriveBackfillSourceIdempotencyKey,
  reconcileBackfillItemStatusTransition,
  deriveBackfillRecoveryMarker,
  buildPlanningScopeIsolationPredicate,
  validatePlanningReadWriteContext,
  evaluatePlanningOptimisticConcurrencyGuard,
  SEMANTIC_SCORING_CONTRACT_VERSION,
  scorePlanningCandidate,
  sortPlanningCandidates,
  determineSemanticDegradedMode,
  classifyEmbeddingLifecycle,
  evaluateSemanticGate,
  evaluatePlanningDurabilityDependencyGate,
  resolveLifecycleCapabilityGate,
  acquirePlanningMutationRouteLock,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
  evaluateLifecycleMixedVersionCompatibility,
  buildLifecycleMixedVersionUnsupportedMarker,
  shouldRemapTrackerMissingTokenPayload,
  buildTrackerProxyPassThroughHeaders,
  buildTrackerProxyResponsePlan,
  recordPlanningCompareReceipt,
  issuePlanningMergeIntent,
  executePlanningMerge,
  rollbackMergeCommitAfterPersistenceFailure,
  proxyToNativeRuntime,
};

