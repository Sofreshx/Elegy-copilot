'use strict';

const crypto = require('crypto');

const PLANNING_PERSISTENCE_HEALTH_CONTRACT_VERSION = '1';
const DEFAULT_SCHEMA_TABLE = 'ie_schema_versions';

const RAW_PLANNING_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: '001_planning_records_init',
    description: 'Create planning records persistence table',
    sql: `
CREATE TABLE IF NOT EXISTS ie_planning_records (
  record_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  repo_id TEXT,
  scope TEXT NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`,
  }),
  Object.freeze({
    version: '002_planning_backfill_runs_init',
    description: 'Create planning backfill runs table',
    sql: `
CREATE TABLE IF NOT EXISTS ie_planning_backfill_runs (
  run_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  repo_id TEXT,
  source_identity TEXT NOT NULL,
  checkpoint_key TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
`,
  }),
  Object.freeze({
    version: '003_planning_backfill_items_ledger_init',
    description: 'Create planning backfill item ledger table',
    sql: `
CREATE TABLE IF NOT EXISTS ie_planning_backfill_items_ledger (
  run_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  repo_id TEXT,
  source_identity TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  record_type TEXT NOT NULL,
  source_idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  status_detail TEXT,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, item_id),
  CONSTRAINT ie_planning_backfill_items_ledger_source_key_uq UNIQUE (scope, source_identity, artifact_path, artifact_hash, record_type)
);
`,
  }),
]);

function parseBooleanFlag(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeMigrationSql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('Migration SQL must be a non-empty string');
  }

  return sql.replace(/\r\n/g, '\n').trim();
}

function computeMigrationChecksum(sql) {
  const normalizedSql = normalizeMigrationSql(sql);
  return crypto.createHash('sha256').update(normalizedSql, 'utf8').digest('hex');
}

function buildMigrationManifest(migrations = RAW_PLANNING_MIGRATIONS) {
  if (!Array.isArray(migrations)) {
    throw new Error('Migrations must be an array');
  }

  const seenVersions = new Set();
  const manifest = [];

  for (const migration of migrations) {
    if (!migration || typeof migration !== 'object') {
      throw new Error('Migration entries must be objects');
    }

    const version = String(migration.version || '').trim();
    if (!version) {
      throw new Error('Migration version is required');
    }

    if (seenVersions.has(version)) {
      throw new Error(`Duplicate migration version: ${version}`);
    }
    seenVersions.add(version);

    const description = String(migration.description || '').trim();
    const normalizedSql = normalizeMigrationSql(migration.sql);
    const checksum = typeof migration.checksum === 'string' && migration.checksum.trim()
      ? migration.checksum.trim().toLowerCase()
      : computeMigrationChecksum(normalizedSql);

    manifest.push(Object.freeze({
      version,
      description,
      sql: normalizedSql,
      checksum,
    }));
  }

  return manifest;
}

const PLANNING_MIGRATION_MANIFEST = Object.freeze(buildMigrationManifest());

const PLANNING_SCOPES = Object.freeze(new Set(['repo', 'global', 'user']));

const BACKFILL_ITEM_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  RECOVERY_CHECKPOINT_ONLY: 'recovery_checkpoint_only',
  RECOVERY_LEDGER_ONLY: 'recovery_ledger_only',
  RECOVERY_MISSING_BOTH: 'recovery_missing_both',
  RECOVERED: 'recovered',
});

const BACKFILL_RECOVERY_MARKERS = Object.freeze({
  CHECKPOINT_ONLY: BACKFILL_ITEM_STATUS.RECOVERY_CHECKPOINT_ONLY,
  LEDGER_ONLY: BACKFILL_ITEM_STATUS.RECOVERY_LEDGER_ONLY,
  MISSING_BOTH: BACKFILL_ITEM_STATUS.RECOVERY_MISSING_BOTH,
});

const BACKFILL_TERMINAL_STATUSES = Object.freeze(new Set([
  BACKFILL_ITEM_STATUS.SUCCEEDED,
  BACKFILL_ITEM_STATUS.FAILED,
  BACKFILL_ITEM_STATUS.SKIPPED,
  BACKFILL_ITEM_STATUS.RECOVERED,
]));

const BACKFILL_TRANSITION_GRAPH = Object.freeze({
  [BACKFILL_ITEM_STATUS.PENDING]: new Set([
    BACKFILL_ITEM_STATUS.PENDING,
    BACKFILL_ITEM_STATUS.PROCESSING,
    BACKFILL_ITEM_STATUS.SUCCEEDED,
    BACKFILL_ITEM_STATUS.FAILED,
    BACKFILL_ITEM_STATUS.SKIPPED,
    BACKFILL_ITEM_STATUS.RECOVERY_CHECKPOINT_ONLY,
    BACKFILL_ITEM_STATUS.RECOVERY_LEDGER_ONLY,
    BACKFILL_ITEM_STATUS.RECOVERY_MISSING_BOTH,
  ]),
  [BACKFILL_ITEM_STATUS.PROCESSING]: new Set([
    BACKFILL_ITEM_STATUS.PROCESSING,
    BACKFILL_ITEM_STATUS.SUCCEEDED,
    BACKFILL_ITEM_STATUS.FAILED,
    BACKFILL_ITEM_STATUS.SKIPPED,
    BACKFILL_ITEM_STATUS.RECOVERY_CHECKPOINT_ONLY,
    BACKFILL_ITEM_STATUS.RECOVERY_LEDGER_ONLY,
    BACKFILL_ITEM_STATUS.RECOVERY_MISSING_BOTH,
  ]),
  [BACKFILL_ITEM_STATUS.SUCCEEDED]: new Set([BACKFILL_ITEM_STATUS.SUCCEEDED]),
  [BACKFILL_ITEM_STATUS.FAILED]: new Set([
    BACKFILL_ITEM_STATUS.FAILED,
    BACKFILL_ITEM_STATUS.RECOVERED,
  ]),
  [BACKFILL_ITEM_STATUS.SKIPPED]: new Set([
    BACKFILL_ITEM_STATUS.SKIPPED,
    BACKFILL_ITEM_STATUS.RECOVERED,
  ]),
  [BACKFILL_ITEM_STATUS.RECOVERY_CHECKPOINT_ONLY]: new Set([
    BACKFILL_ITEM_STATUS.RECOVERY_CHECKPOINT_ONLY,
    BACKFILL_ITEM_STATUS.RECOVERED,
    BACKFILL_ITEM_STATUS.FAILED,
  ]),
  [BACKFILL_ITEM_STATUS.RECOVERY_LEDGER_ONLY]: new Set([
    BACKFILL_ITEM_STATUS.RECOVERY_LEDGER_ONLY,
    BACKFILL_ITEM_STATUS.RECOVERED,
    BACKFILL_ITEM_STATUS.FAILED,
  ]),
  [BACKFILL_ITEM_STATUS.RECOVERY_MISSING_BOTH]: new Set([
    BACKFILL_ITEM_STATUS.RECOVERY_MISSING_BOTH,
    BACKFILL_ITEM_STATUS.RECOVERED,
    BACKFILL_ITEM_STATUS.FAILED,
  ]),
  [BACKFILL_ITEM_STATUS.RECOVERED]: new Set([BACKFILL_ITEM_STATUS.RECOVERED]),
});

function normalizeScope(scope) {
  const value = String(scope == null ? '' : scope).trim().toLowerCase();
  return PLANNING_SCOPES.has(value) ? value : null;
}

function normalizeIdentity(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeArtifactPath(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
  return normalized || null;
}

function normalizeToken(value, { lowerCase = true } = {}) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return lowerCase ? normalized.toLowerCase() : normalized;
}

function deriveBackfillSourceIdempotencyKey(input = {}) {
  const scope = normalizeScope(input.scope);
  const sourceIdentity = normalizeIdentity(input.sourceIdentity);
  const artifactPath = normalizeArtifactPath(input.artifactPath);
  const artifactHash = normalizeToken(input.artifactHash);
  const recordType = normalizeToken(input.recordType);

  if (!scope || !sourceIdentity || !artifactPath || !artifactHash || !recordType) {
    throw new Error('Backfill source idempotency key requires scope, sourceIdentity, artifactPath, artifactHash, and recordType');
  }

  const canonical = [scope, sourceIdentity, artifactPath, artifactHash, recordType].join('|');
  const digest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `backfill:${digest}`;
}

function normalizeBackfillStatus(value) {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  return BACKFILL_TRANSITION_GRAPH[normalized] ? normalized : null;
}

function reconcileBackfillItemStatusTransition(input = {}) {
  const currentStatus = normalizeBackfillStatus(input.currentStatus) || BACKFILL_ITEM_STATUS.PENDING;
  const nextStatus = normalizeBackfillStatus(input.nextStatus);

  if (!nextStatus) {
    return {
      ok: false,
      deterministic: true,
      error: {
        code: 'invalid_backfill_status',
        reason: 'next_status_invalid',
      },
    };
  }

  const allowed = BACKFILL_TRANSITION_GRAPH[currentStatus];
  if (!allowed || !allowed.has(nextStatus)) {
    return {
      ok: false,
      deterministic: true,
      error: {
        code: 'invalid_backfill_transition',
        reason: `${currentStatus}->${nextStatus}`,
      },
      currentStatus,
      nextStatus,
    };
  }

  const replay = currentStatus === nextStatus;
  const requiresRecovery = nextStatus === BACKFILL_ITEM_STATUS.RECOVERY_CHECKPOINT_ONLY
    || nextStatus === BACKFILL_ITEM_STATUS.RECOVERY_LEDGER_ONLY
    || nextStatus === BACKFILL_ITEM_STATUS.RECOVERY_MISSING_BOTH;

  return {
    ok: true,
    deterministic: true,
    replay,
    changed: !replay,
    currentStatus,
    nextStatus,
    resolvedStatus: nextStatus,
    requiresRecovery,
    terminal: BACKFILL_TERMINAL_STATUSES.has(nextStatus),
    outcome: replay
      ? 'replay_noop'
      : requiresRecovery
        ? 'recovery_required'
        : BACKFILL_TERMINAL_STATUSES.has(nextStatus)
          ? 'transition_applied_terminal'
          : 'transition_applied',
  };
}

function deriveBackfillRecoveryMarker(input = {}) {
  const hasCheckpoint = input.hasCheckpoint === true;
  const hasLedgerData = input.hasLedgerData === true || input.hasData === true;

  if (hasCheckpoint && hasLedgerData) {
    return {
      requiresRecovery: false,
      marker: null,
      status: null,
      reason: 'checkpoint_and_data_consistent',
    };
  }

  if (hasCheckpoint && !hasLedgerData) {
    return {
      requiresRecovery: true,
      marker: BACKFILL_RECOVERY_MARKERS.CHECKPOINT_ONLY,
      status: BACKFILL_RECOVERY_MARKERS.CHECKPOINT_ONLY,
      reason: 'checkpoint_without_data',
    };
  }

  if (!hasCheckpoint && hasLedgerData) {
    return {
      requiresRecovery: true,
      marker: BACKFILL_RECOVERY_MARKERS.LEDGER_ONLY,
      status: BACKFILL_RECOVERY_MARKERS.LEDGER_ONLY,
      reason: 'data_without_checkpoint',
    };
  }

  return {
    requiresRecovery: true,
    marker: BACKFILL_RECOVERY_MARKERS.MISSING_BOTH,
    status: BACKFILL_RECOVERY_MARKERS.MISSING_BOTH,
    reason: 'checkpoint_and_data_missing',
  };
}

function buildPlanningScopeIsolationPredicate(input = {}) {
  const scope = normalizeScope(input.scope);
  const ownerId = normalizeIdentity(input.ownerId);
  const repoId = normalizeIdentity(input.repoId);
  const tableAlias = normalizeToken(input.tableAlias, { lowerCase: false }) || 'p';

  if (!scope || !ownerId) {
    return {
      ok: false,
      deny: true,
      where: '1=0',
      params: [],
      error: {
        code: 'scope_context_denied',
        reason: 'missing_scope_or_owner',
      },
    };
  }

  if (scope === 'repo') {
    if (!repoId) {
      return {
        ok: false,
        deny: true,
        where: '1=0',
        params: [],
        error: {
          code: 'scope_context_denied',
          reason: 'repo_scope_requires_repo_id',
        },
      };
    }

    return {
      ok: true,
      deny: false,
      where: `${tableAlias}.scope = $1 AND ${tableAlias}.owner_id = $2 AND ${tableAlias}.repo_id = $3`,
      params: [scope, ownerId, repoId],
      scope,
    };
  }

  return {
    ok: true,
    deny: false,
    where: `${tableAlias}.scope = $1 AND ${tableAlias}.owner_id = $2`,
    params: [scope, ownerId],
    scope,
  };
}

function validatePlanningReadWriteContext(input = {}) {
  const action = normalizeToken(input.action) || 'read';
  const scope = normalizeScope(input.scope);
  const actorId = normalizeIdentity(input.actorId);
  const ownerId = normalizeIdentity(input.ownerId);
  const repoId = normalizeIdentity(input.repoId);

  if (action !== 'read' && action !== 'write') {
    return {
      ok: false,
      allowed: false,
      denyByDefault: true,
      error: {
        code: 'scope_visibility_denied',
        reason: 'invalid_action',
      },
    };
  }

  if (!scope || !actorId || !ownerId || actorId !== ownerId) {
    return {
      ok: false,
      allowed: false,
      denyByDefault: true,
      action,
      scope,
      error: {
        code: 'scope_visibility_denied',
        reason: 'owner_identity_mismatch_or_missing',
      },
    };
  }

  if (scope === 'repo' && !repoId) {
    return {
      ok: false,
      allowed: false,
      denyByDefault: true,
      action,
      scope,
      error: {
        code: 'scope_visibility_denied',
        reason: 'repo_scope_requires_repo_id',
      },
    };
  }

  return {
    ok: true,
    allowed: true,
    denyByDefault: true,
    action,
    scope,
    actorId,
    ownerId,
    repoId: scope === 'repo' ? repoId : null,
  };
}

function normalizeConcurrencyToken(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }
  return String(value);
}

function evaluatePlanningOptimisticConcurrencyGuard(input = {}) {
  const expectedVersion = normalizeConcurrencyToken(input.expectedVersion);
  const expectedEtag = normalizeConcurrencyToken(input.expectedEtag);
  const actualVersion = normalizeConcurrencyToken(input.actualVersion);
  const actualEtag = normalizeConcurrencyToken(input.actualEtag);
  const resourceType = normalizeToken(input.resourceType, { lowerCase: false }) || 'planning_record';
  const resourceId = normalizeConcurrencyToken(input.resourceId);

  const checks = {
    version: {
      enforced: expectedVersion != null,
      expected: expectedVersion,
      actual: actualVersion,
      match: expectedVersion == null ? true : expectedVersion === actualVersion,
    },
    etag: {
      enforced: expectedEtag != null,
      expected: expectedEtag,
      actual: actualEtag,
      match: expectedEtag == null ? true : expectedEtag === actualEtag,
    },
  };

  const versionMismatch = checks.version.enforced && !checks.version.match;
  const etagMismatch = checks.etag.enforced && !checks.etag.match;

  if (!versionMismatch && !etagMismatch) {
    return {
      ok: true,
      conflict: false,
      result: {
        kind: 'ok',
        code: 'optimistic_concurrency_ok',
        resourceType,
        resourceId,
        checks,
      },
    };
  }

  const conflictType = versionMismatch && etagMismatch
    ? 'version_etag_mismatch'
    : versionMismatch
      ? 'version_mismatch'
      : 'etag_mismatch';

  return {
    ok: false,
    conflict: true,
    code: 'optimistic_concurrency_conflict',
    result: {
      kind: 'conflict',
      code: 'optimistic_concurrency_conflict',
      conflictType,
      retryable: true,
      resourceType,
      resourceId,
      checks,
    },
  };
}

function readPlanningPersistenceConfig(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  const databaseUrl = typeof source.INSTRUCTION_ENGINE_PLANNING_DB_URL === 'string'
    ? source.INSTRUCTION_ENGINE_PLANNING_DB_URL.trim()
    : '';

  return {
    required: parseBooleanFlag(source.INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED),
    databaseUrl: databaseUrl || null,
    schemaTable: DEFAULT_SCHEMA_TABLE,
  };
}

function validatePlanningPersistenceConfig(config = {}) {
  const required = Boolean(config.required);
  const databaseUrl = typeof config.databaseUrl === 'string' && config.databaseUrl.trim()
    ? config.databaseUrl.trim()
    : null;

  const errors = [];

  if (required && !databaseUrl) {
    errors.push('database_url_required');
  }

  if (databaseUrl) {
    let parsed;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      errors.push('invalid_database_url');
    }

    if (parsed && !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      errors.push('invalid_database_url_protocol');
    }

    if (parsed && (!parsed.hostname || parsed.pathname === '/' || !parsed.pathname)) {
      errors.push('database_name_required');
    }
  }

  const configured = Boolean(databaseUrl);
  const usable = configured && errors.length === 0;

  return {
    ok: errors.length === 0,
    required,
    configured,
    usable,
    status: configured ? (usable ? 'valid' : 'invalid') : 'not_configured',
    errors,
  };
}

function normalizeSchemaTableName(schemaTable) {
  const tableName = typeof schemaTable === 'string' && schemaTable.trim()
    ? schemaTable.trim()
    : DEFAULT_SCHEMA_TABLE;

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid schema table name: ${tableName}`);
  }

  return tableName;
}

function normalizeManifest(migrations) {
  if (!Array.isArray(migrations)) {
    return PLANNING_MIGRATION_MANIFEST;
  }

  if (!migrations.length) {
    return [];
  }

  if (migrations.every((m) => m && typeof m.checksum === 'string' && m.checksum.trim())) {
    return buildMigrationManifest(migrations);
  }

  return buildMigrationManifest(migrations);
}

function ensureQueryClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('Planning migration client must expose query(sql, params)');
  }
}

function createChecksumDriftError({ version, expectedChecksum, actualChecksum }) {
  const error = new Error(`Planning migration checksum drift detected for version ${version}`);
  error.code = 'PLANNING_MIGRATION_CHECKSUM_DRIFT';
  error.version = version;
  error.expectedChecksum = expectedChecksum;
  error.actualChecksum = actualChecksum;
  return error;
}

async function runPlanningMigrations(client, options = {}) {
  ensureQueryClient(client);

  const schemaTable = normalizeSchemaTableName(options.schemaTable);
  const manifest = normalizeManifest(options.migrations);
  const latestVersion = manifest.length ? manifest[manifest.length - 1].version : null;

  await client.query(`
CREATE TABLE IF NOT EXISTS ${schemaTable} (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`);

  const existingResult = await client.query(`
SELECT version, checksum, applied_at
FROM ${schemaTable}
ORDER BY version ASC
`);

  const existingRows = Array.isArray(existingResult && existingResult.rows)
    ? existingResult.rows
    : [];

  const existingByVersion = new Map();
  for (const row of existingRows) {
    if (!row || typeof row !== 'object') continue;
    const version = String(row.version || '').trim();
    if (!version) continue;
    const checksum = String(row.checksum || '').trim().toLowerCase();
    existingByVersion.set(version, checksum);
  }

  const missingMigrations = [];
  for (const migration of manifest) {
    const existingChecksum = existingByVersion.get(migration.version);
    if (existingChecksum && existingChecksum !== migration.checksum) {
      throw createChecksumDriftError({
        version: migration.version,
        expectedChecksum: migration.checksum,
        actualChecksum: existingChecksum,
      });
    }

    if (!existingChecksum) {
      missingMigrations.push(migration);
    }
  }

  if (!missingMigrations.length) {
    return {
      schemaTable,
      latestVersion,
      manifestCount: manifest.length,
      appliedCount: 0,
      appliedVersions: [],
      driftDetected: false,
    };
  }

  await client.query('BEGIN');
  try {
    for (const migration of missingMigrations) {
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO ${schemaTable} (version, checksum, applied_at) VALUES ($1, $2, NOW())`,
        [migration.version, migration.checksum],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // best effort
    }
    throw error;
  }

  return {
    schemaTable,
    latestVersion,
    manifestCount: manifest.length,
    appliedCount: missingMigrations.length,
    appliedVersions: missingMigrations.map((migration) => migration.version),
    driftDetected: false,
  };
}

function getPlanningPersistenceHealth(config, state = {}) {
  const validation = state.validation || validatePlanningPersistenceConfig(config);
  const latestVersion = PLANNING_MIGRATION_MANIFEST.length
    ? PLANNING_MIGRATION_MANIFEST[PLANNING_MIGRATION_MANIFEST.length - 1].version
    : null;
  const migrationState = state.migrations && typeof state.migrations === 'object'
    ? state.migrations
    : {};

  const status = typeof state.status === 'string' && state.status.trim()
    ? state.status.trim()
    : (validation.usable ? 'ready' : validation.configured ? 'invalid_config' : 'disabled');

  return {
    contractVersion: PLANNING_PERSISTENCE_HEALTH_CONTRACT_VERSION,
    required: Boolean(validation.required),
    configured: Boolean(validation.configured),
    usable: Boolean(validation.usable),
    status,
    errors: Array.isArray(validation.errors) ? [...validation.errors] : [],
    lastError: state.lastError ? String(state.lastError) : null,
    migrations: {
      schemaTable: migrationState.schemaTable || DEFAULT_SCHEMA_TABLE,
      latestVersion,
      appliedCount: Number.isFinite(migrationState.appliedCount) ? migrationState.appliedCount : 0,
      appliedVersions: Array.isArray(migrationState.appliedVersions) ? [...migrationState.appliedVersions] : [],
      driftDetected: Boolean(migrationState.driftDetected),
      lastRunAt: migrationState.lastRunAt || null,
    },
  };
}

module.exports = {
  BACKFILL_ITEM_STATUS,
  BACKFILL_RECOVERY_MARKERS,
  DEFAULT_SCHEMA_TABLE,
  PLANNING_PERSISTENCE_HEALTH_CONTRACT_VERSION,
  PLANNING_MIGRATION_MANIFEST,
  buildPlanningScopeIsolationPredicate,
  computeMigrationChecksum,
  deriveBackfillRecoveryMarker,
  deriveBackfillSourceIdempotencyKey,
  evaluatePlanningOptimisticConcurrencyGuard,
  readPlanningPersistenceConfig,
  reconcileBackfillItemStatusTransition,
  validatePlanningPersistenceConfig,
  validatePlanningReadWriteContext,
  getPlanningPersistenceHealth,
  runPlanningMigrations,
};
