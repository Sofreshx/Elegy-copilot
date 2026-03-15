'use strict';

const crypto = require('crypto');
const {
  DEFAULT_RUNTIME_PROVIDER,
  RUNTIME_PROVIDER_SELECTION_SOURCES,
  normalizeRuntimeProvider,
} = require('./runtimeContracts');

const PLANNING_PERSISTENCE_HEALTH_CONTRACT_VERSION = '1';
const PLANNING_PROVIDER_STATE_CONTRACT_VERSION = '1';
const PLANNING_PERSISTENCE_SNAPSHOT_CONTRACT_VERSION = '1';
const DEFAULT_SCHEMA_TABLE = 'ie_schema_versions';
const PLANNING_PERSISTENCE_HEALTH_STATUSES = Object.freeze(new Set([
  'ready',
  'invalid_config',
  'disabled',
  'configured_no_client',
  'drift_detected',
  'migration_error',
]));

const PLANNING_WS5A_DURABILITY_REQUIRED_MIGRATION_VERSIONS = Object.freeze([
  '004_planning_compare_receipts_init',
  '005_planning_merge_intents_init',
  '006_planning_merge_idempotency_ledger_init',
  '007_planning_suggestions_init',
  '008_planning_recaps_init',
]);

const PLANNING_WS5A_DURABILITY_ARTIFACT_TABLES = Object.freeze({
  COMPARE_RECEIPTS: 'ie_planning_compare_receipts',
  MERGE_INTENTS: 'ie_planning_merge_intents',
  MERGE_IDEMPOTENCY_LEDGER: 'ie_planning_merge_idempotency_ledger',
  SUGGESTIONS: 'ie_planning_suggestions',
  RECAPS: 'ie_planning_recaps',
});

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
  Object.freeze({
    version: '004_planning_compare_receipts_init',
    description: 'Create planning compare receipts durability table',
    sql: `
CREATE TABLE IF NOT EXISTS ie_planning_compare_receipts (
  receipt_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  repo_id TEXT,
  compare_hash TEXT NOT NULL,
  source_ids_hash TEXT NOT NULL,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  version_vector JSONB,
  gate_state TEXT NOT NULL,
  merge_eligible BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  downgrade JSONB,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`,
  }),
  Object.freeze({
    version: '005_planning_merge_intents_init',
    description: 'Create planning merge intents durability table',
    sql: `
CREATE TABLE IF NOT EXISTS ie_planning_merge_intents (
  token_id TEXT PRIMARY KEY,
  compare_receipt_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  repo_id TEXT,
  target_id TEXT NOT NULL,
  source_ids_hash TEXT NOT NULL,
  compare_hash TEXT NOT NULL,
  version_vector JSONB,
  version_vector_hash TEXT,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`,
  }),
  Object.freeze({
    version: '006_planning_merge_idempotency_ledger_init',
    description: 'Create planning merge idempotency ledger table',
    sql: `
CREATE TABLE IF NOT EXISTS ie_planning_merge_idempotency_ledger (
  idempotency_key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  repo_id TEXT,
  operation_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_ids_hash TEXT NOT NULL,
  compare_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  merge_record_id TEXT,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
`,
  }),
  Object.freeze({
    version: '007_planning_suggestions_init',
    description: 'Create planning suggestions durability table',
    sql: `
CREATE TABLE IF NOT EXISTS ie_planning_suggestions (
  suggestion_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  repo_id TEXT,
  scope TEXT NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`,
  }),
  Object.freeze({
    version: '008_planning_recaps_init',
    description: 'Create planning recaps durability table',
    sql: `
CREATE TABLE IF NOT EXISTS ie_planning_recaps (
  recap_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  repo_id TEXT,
  scope TEXT NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`,
  }),
]);

const MIGRATION_CHECKSUM_OUTCOME = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
});

const MIGRATION_CHECKSUM_REASON = Object.freeze({
  VERIFIED: 'all_manifest_checksums_match',
  DRIFT_DETECTED: 'manifest_checksum_drift_detected',
  BASELINE_MISMATCH: 'manifest_checksum_baseline_mismatch',
});

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

function computeManifestChecksumBaseline(migrations = PLANNING_MIGRATION_MANIFEST) {
  const manifest = Array.isArray(migrations) ? migrations : [];
  const canonical = manifest
    .map((migration) => {
      const version = String(migration && migration.version ? migration.version : '').trim();
      const checksum = String(migration && migration.checksum ? migration.checksum : '').trim().toLowerCase();
      return version && checksum ? `${version}:${checksum}` : '';
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return crypto.createHash('sha256').update(canonical.join('\n'), 'utf8').digest('hex');
}

const PLANNING_MIGRATION_CHECKSUM_BASELINE = computeManifestChecksumBaseline(PLANNING_MIGRATION_MANIFEST);

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

function normalizeDeterministicStringArray(values) {
  const list = Array.isArray(values) ? values : [];
  const normalized = [];

  for (const value of list) {
    const token = normalizeToken(value, { lowerCase: false });
    if (!token) continue;
    normalized.push(token);
  }

  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function normalizePlanningPersistenceStatus(status, validation) {
  const normalizedStatus = normalizeToken(status);
  if (normalizedStatus && PLANNING_PERSISTENCE_HEALTH_STATUSES.has(normalizedStatus)) {
    return normalizedStatus;
  }

  if (validation && validation.usable) {
    return 'ready';
  }

  if (validation && validation.configured) {
    return 'invalid_config';
  }

  return 'disabled';
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const floored = Math.floor(numeric);
  return floored >= 0 ? floored : fallback;
}

function firstValidRuntimeProvider(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (const candidate of list) {
    const normalized = normalizeRuntimeProvider(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function hasNonEmptyToken(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeReasonCodes(values) {
  const list = Array.isArray(values) ? values : [];
  const normalized = [];

  for (const value of list) {
    const token = normalizeToken(value);
    if (!token) continue;
    normalized.push(token);
  }

  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function normalizeChecksumValidationOutcome(value) {
  const token = normalizeToken(value);
  if (token === MIGRATION_CHECKSUM_OUTCOME.PASS) return MIGRATION_CHECKSUM_OUTCOME.PASS;
  if (token === MIGRATION_CHECKSUM_OUTCOME.FAIL) return MIGRATION_CHECKSUM_OUTCOME.FAIL;
  return null;
}

function normalizeChecksumValidationReason(value) {
  const token = normalizeToken(value);
  if (token === MIGRATION_CHECKSUM_REASON.VERIFIED) return MIGRATION_CHECKSUM_REASON.VERIFIED;
  if (token === MIGRATION_CHECKSUM_REASON.DRIFT_DETECTED) return MIGRATION_CHECKSUM_REASON.DRIFT_DETECTED;
  if (token === MIGRATION_CHECKSUM_REASON.BASELINE_MISMATCH) return MIGRATION_CHECKSUM_REASON.BASELINE_MISMATCH;
  return null;
}

function normalizeChecksumValidationFailure(value) {
  if (!isPlainObject(value)) return null;

  const version = normalizeToken(value.version, { lowerCase: false });
  const expectedChecksum = normalizeToken(value.expectedChecksum);
  const actualChecksum = normalizeToken(value.actualChecksum);
  const unexpectedVersions = normalizeDeterministicStringArray(value.unexpectedVersions);
  const detail = normalizeToken(value.detail, { lowerCase: false });

  if (!version && !expectedChecksum && !actualChecksum && !unexpectedVersions.length && !detail) {
    return null;
  }

  return {
    version,
    expectedChecksum,
    actualChecksum,
    unexpectedVersions,
    detail,
  };
}

function normalizeMigrationChecksumValidation(input = {}, defaults = {}) {
  const source = isPlainObject(input) ? input : {};
  const fallback = isPlainObject(defaults) ? defaults : {};

  const checkedVersions = normalizeDeterministicStringArray(
    Array.isArray(source.checkedVersions)
      ? source.checkedVersions
      : Array.isArray(fallback.checkedVersions)
        ? fallback.checkedVersions
        : [],
  );

  const manifestVersionCount = normalizePositiveInteger(
    source.manifestVersionCount,
    normalizePositiveInteger(
      fallback.manifestVersionCount,
      checkedVersions.length,
    ),
  );

  const outcome = normalizeChecksumValidationOutcome(source.outcome)
    || normalizeChecksumValidationOutcome(fallback.outcome)
    || MIGRATION_CHECKSUM_OUTCOME.PASS;

  const driftDetected = Boolean(source.driftDetected)
    || Boolean(fallback.driftDetected);

  const baselineMismatch = Boolean(source.baselineMismatch)
    || Boolean(fallback.baselineMismatch);

  const reason = normalizeChecksumValidationReason(source.reason)
    || normalizeChecksumValidationReason(fallback.reason)
    || (baselineMismatch
      ? MIGRATION_CHECKSUM_REASON.BASELINE_MISMATCH
      : driftDetected
        ? MIGRATION_CHECKSUM_REASON.DRIFT_DETECTED
        : MIGRATION_CHECKSUM_REASON.VERIFIED);

  return {
    outcome,
    reason,
    driftDetected,
    baselineMismatch,
    checkedVersionCount: normalizePositiveInteger(source.checkedVersionCount, checkedVersions.length),
    checkedVersions,
    manifestVersionCount,
    manifestChecksumBaseline: normalizeToken(source.manifestChecksumBaseline)
      || normalizeToken(fallback.manifestChecksumBaseline)
      || PLANNING_MIGRATION_CHECKSUM_BASELINE,
    enforcement: normalizeToken(source.enforcement, { lowerCase: false })
      || normalizeToken(fallback.enforcement, { lowerCase: false })
      || 'fail_closed',
    failure: normalizeChecksumValidationFailure(source.failure)
      || normalizeChecksumValidationFailure(fallback.failure)
      || null,
  };
}

function derivePlanningPersistenceGovernance(health = {}) {
  const source = isPlainObject(health) ? health : {};
  const status = normalizeToken(source.status) || 'disabled';
  const migrationChecksumValidation = source.migrations
    && isPlainObject(source.migrations)
    && isPlainObject(source.migrations.checksumValidation)
    ? source.migrations.checksumValidation
    : {};

  let code = 'planning_persistence_disabled';
  if (status === 'ready') {
    code = 'planning_persistence_ready';
  } else if (status === 'invalid_config') {
    code = 'planning_persistence_invalid_config';
  } else if (status === 'configured_no_client') {
    code = 'planning_persistence_client_unavailable';
  } else if (status === 'drift_detected') {
    code = Boolean(migrationChecksumValidation.baselineMismatch)
      ? 'planning_persistence_checksum_baseline_mismatch'
      : 'planning_persistence_checksum_drift';
  } else if (status === 'migration_error') {
    code = 'planning_persistence_migration_error';
  }

  return {
    deterministic: true,
    failClosed: true,
    ready: status === 'ready',
    code,
    reason: code,
    reasonCodes: normalizeReasonCodes([
      code,
      ...(Array.isArray(source.errors) ? source.errors : []),
      migrationChecksumValidation.reason,
    ]),
  };
}

function buildPlanningProviderStatePersistencePayload(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const defaultProvider = normalizeRuntimeProvider(source.defaultProvider) || DEFAULT_RUNTIME_PROVIDER;
  const explicitSelected = normalizeRuntimeProvider(source.selectedProvider);
  const selectedProvider = explicitSelected || defaultProvider;
  const requestedSelectionSource = normalizeToken(source.selectionSource);

  let selectionSource = explicitSelected
    ? RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT
    : RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT;

  if (requestedSelectionSource === RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT) {
    selectionSource = RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT;
  }

  if (
    requestedSelectionSource === RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT
    && explicitSelected
  ) {
    selectionSource = RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT;
  }

  return {
    contractVersion: PLANNING_PROVIDER_STATE_CONTRACT_VERSION,
    selectedProvider,
    defaultProvider,
    selectionSource,
  };
}

function readPlanningProviderState(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const persisted = isPlainObject(source.persistedState) ? source.persistedState : null;
  const env = isPlainObject(source.env) ? source.env : {};
  const reasons = [];

  const persistedContractVersion = persisted && hasNonEmptyToken(persisted.contractVersion)
    ? String(persisted.contractVersion).trim()
    : null;

  const persistedSelectionSource = persisted
    ? normalizeToken(persisted.selectionSource)
    : null;

  const persistedSelected = persisted
    ? normalizeRuntimeProvider(persisted.selectedProvider)
    : null;

  const persistedDefault = persisted
    ? normalizeRuntimeProvider(persisted.defaultProvider)
    : null;

  const persistedLegacySelected = persisted
    ? firstValidRuntimeProvider([
      persisted.runtimeProviderSelected,
      persisted.runtimeProvider,
      persisted.provider,
    ])
    : null;

  const persistedLegacyDefault = persisted
    ? firstValidRuntimeProvider([
      persisted.runtimeProviderDefault,
      persisted.providerDefault,
    ])
    : null;

  const envSelected = firstValidRuntimeProvider([
    env.INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED,
    env.INSTRUCTION_ENGINE_RUNTIME_PROVIDER,
  ]);

  const envDefault = normalizeRuntimeProvider(env.INSTRUCTION_ENGINE_RUNTIME_PROVIDER_DEFAULT);

  let resolvedSelected = null;
  let selectedSource = 'none';

  if (persistedSelected) {
    resolvedSelected = persistedSelected;
    selectedSource = persistedSelectionSource === RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT
      ? 'persisted_default_selected'
      : 'persisted_selected';
  } else if (persistedLegacySelected) {
    resolvedSelected = persistedLegacySelected;
    selectedSource = 'persisted_legacy_selected';
    reasons.push('legacy_selected_provider_migrated');
  } else if (envSelected) {
    resolvedSelected = envSelected;
    selectedSource = 'env_selected';
    reasons.push('env_selected_provider_migrated');
  }

  let resolvedDefault = null;
  let defaultSource = 'none';

  if (persistedDefault) {
    resolvedDefault = persistedDefault;
    defaultSource = 'persisted_default';
  } else if (persistedLegacyDefault) {
    resolvedDefault = persistedLegacyDefault;
    defaultSource = 'persisted_legacy_default';
    reasons.push('legacy_default_provider_migrated');
  } else if (envDefault) {
    resolvedDefault = envDefault;
    defaultSource = 'env_default';
    reasons.push('env_default_provider_migrated');
  } else {
    resolvedDefault = DEFAULT_RUNTIME_PROVIDER;
    defaultSource = 'fallback_default';
    reasons.push('default_provider_applied');
  }

  if (!resolvedSelected) {
    resolvedSelected = resolvedDefault;
    selectedSource = 'default_provider';
  }

  if (!persisted) {
    reasons.push('provider_state_absent');
  }

  if (persisted && persistedContractVersion !== PLANNING_PROVIDER_STATE_CONTRACT_VERSION) {
    reasons.push('provider_state_contract_mismatch');
  }

  if (persisted && hasNonEmptyToken(persisted.selectedProvider) && !persistedSelected) {
    reasons.push('invalid_selected_provider');
  }

  if (persisted && hasNonEmptyToken(persisted.defaultProvider) && !persistedDefault) {
    reasons.push('invalid_default_provider');
  }

  const canonical = buildPlanningProviderStatePersistencePayload({
    selectedProvider: resolvedSelected,
    defaultProvider: resolvedDefault,
    selectionSource: selectedSource === 'default_provider' || selectedSource === 'persisted_default_selected'
      ? RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT
      : RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT,
  });

  const reasonCodes = normalizeReasonCodes(reasons);
  const selectedFromPersisted = selectedSource === 'persisted_selected'
    || selectedSource === 'persisted_default_selected';

  const migrationRequired = reasonCodes.length > 0
    || !selectedFromPersisted
    || defaultSource !== 'persisted_default';

  return {
    ...canonical,
    migration: {
      required: migrationRequired,
      reasonCodes,
      selectedSource,
      defaultSource,
    },
  };
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
      deterministic: true,
      code: 'optimistic_concurrency_ok',
      reason: 'optimistic_concurrency_ok',
      error: null,
      result: {
        kind: 'ok',
        code: 'optimistic_concurrency_ok',
        reason: 'optimistic_concurrency_ok',
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
    deterministic: true,
    code: 'optimistic_concurrency_conflict',
    reason: conflictType,
    error: {
      code: 'optimistic_concurrency_conflict',
      reason: conflictType,
    },
    result: {
      kind: 'conflict',
      code: 'optimistic_concurrency_conflict',
      reason: conflictType,
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
  error.checksumValidation = normalizeMigrationChecksumValidation({
    outcome: MIGRATION_CHECKSUM_OUTCOME.FAIL,
    reason: MIGRATION_CHECKSUM_REASON.DRIFT_DETECTED,
    driftDetected: true,
    baselineMismatch: false,
    failure: {
      version,
      expectedChecksum,
      actualChecksum,
    },
  });
  return error;
}

function createChecksumBaselineMismatchError({
  expectedChecksumBaseline,
  actualChecksumBaseline,
  unexpectedVersions,
  detail,
}) {
  const suffix = detail ? ` (${detail})` : '';
  const error = new Error(`Planning migration checksum baseline mismatch detected${suffix}`);
  error.code = 'PLANNING_MIGRATION_BASELINE_MISMATCH';
  error.expectedChecksumBaseline = expectedChecksumBaseline;
  error.actualChecksumBaseline = actualChecksumBaseline;
  error.unexpectedVersions = normalizeDeterministicStringArray(unexpectedVersions);
  error.checksumValidation = normalizeMigrationChecksumValidation({
    outcome: MIGRATION_CHECKSUM_OUTCOME.FAIL,
    reason: MIGRATION_CHECKSUM_REASON.BASELINE_MISMATCH,
    driftDetected: true,
    baselineMismatch: true,
    manifestChecksumBaseline: expectedChecksumBaseline,
    failure: {
      expectedChecksum: expectedChecksumBaseline,
      actualChecksum: actualChecksumBaseline,
      unexpectedVersions,
      detail,
    },
  });
  return error;
}

function buildChecksumPassResult({ checkedVersions, manifestVersionCount, manifestChecksumBaseline }) {
  const versions = normalizeDeterministicStringArray(checkedVersions);
  return normalizeMigrationChecksumValidation({
    outcome: MIGRATION_CHECKSUM_OUTCOME.PASS,
    reason: MIGRATION_CHECKSUM_REASON.VERIFIED,
    driftDetected: false,
    baselineMismatch: false,
    checkedVersionCount: versions.length,
    checkedVersions: versions,
    manifestVersionCount: normalizePositiveInteger(manifestVersionCount, versions.length),
    manifestChecksumBaseline: normalizeToken(manifestChecksumBaseline)
      || PLANNING_MIGRATION_CHECKSUM_BASELINE,
    enforcement: 'fail_closed',
    failure: null,
  });
}

async function runPlanningMigrations(client, options = {}) {
  ensureQueryClient(client);

  const schemaTable = normalizeSchemaTableName(options.schemaTable);
  const manifest = normalizeManifest(options.migrations);
  const latestVersion = manifest.length ? manifest[manifest.length - 1].version : null;
  const manifestChecksumBaseline = computeManifestChecksumBaseline(manifest);

  const expectedChecksumBaseline = normalizeToken(options.expectedChecksumBaseline)
    || null;

  if (expectedChecksumBaseline && expectedChecksumBaseline !== manifestChecksumBaseline) {
    throw createChecksumBaselineMismatchError({
      expectedChecksumBaseline,
      actualChecksumBaseline: manifestChecksumBaseline,
      unexpectedVersions: [],
      detail: 'expected_checksum_baseline_mismatch',
    });
  }

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
  const existingEntries = [];
  for (const row of existingRows) {
    if (!row || typeof row !== 'object') continue;
    const version = String(row.version || '').trim();
    if (!version) continue;
    const checksum = String(row.checksum || '').trim().toLowerCase();
    existingByVersion.set(version, checksum);
    existingEntries.push({ version, checksum });
  }

  const manifestVersionSet = new Set(manifest.map((migration) => migration.version));
  const unexpectedVersions = existingEntries
    .filter((entry) => !manifestVersionSet.has(entry.version))
    .map((entry) => entry.version)
    .sort((a, b) => a.localeCompare(b));

  if (unexpectedVersions.length > 0) {
    throw createChecksumBaselineMismatchError({
      expectedChecksumBaseline: manifestChecksumBaseline,
      actualChecksumBaseline: computeManifestChecksumBaseline(existingEntries),
      unexpectedVersions,
      detail: 'unexpected_existing_migration_versions',
    });
  }

  const missingMigrations = [];
  const checkedVersions = [];
  for (const migration of manifest) {
    checkedVersions.push(migration.version);
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
    const checksumValidation = buildChecksumPassResult({
      checkedVersions,
      manifestVersionCount: manifest.length,
      manifestChecksumBaseline,
    });
    return {
      schemaTable,
      latestVersion,
      manifestCount: manifest.length,
      checksumBaseline: manifestChecksumBaseline,
      baselineEnforced: true,
      baselineMismatch: false,
      appliedCount: 0,
      appliedVersions: [],
      driftDetected: false,
      checksumValidation,
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

  const checksumValidation = buildChecksumPassResult({
    checkedVersions,
    manifestVersionCount: manifest.length,
    manifestChecksumBaseline,
  });
  return {
    schemaTable,
    latestVersion,
    manifestCount: manifest.length,
    checksumBaseline: manifestChecksumBaseline,
    baselineEnforced: true,
    baselineMismatch: false,
    appliedCount: missingMigrations.length,
    appliedVersions: missingMigrations.map((migration) => migration.version),
    driftDetected: false,
    checksumValidation,
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

  const status = normalizePlanningPersistenceStatus(state.status, validation);

  const manifestCount = normalizePositiveInteger(
    migrationState.manifestCount,
    PLANNING_MIGRATION_MANIFEST.length,
  );

  const baselineMismatch = Boolean(migrationState.baselineMismatch);
  const checksumValidation = normalizeMigrationChecksumValidation(
    migrationState.checksumValidation,
    {
      outcome: baselineMismatch || Boolean(migrationState.driftDetected)
        ? MIGRATION_CHECKSUM_OUTCOME.FAIL
        : MIGRATION_CHECKSUM_OUTCOME.PASS,
      reason: baselineMismatch
        ? MIGRATION_CHECKSUM_REASON.BASELINE_MISMATCH
        : Boolean(migrationState.driftDetected)
          ? MIGRATION_CHECKSUM_REASON.DRIFT_DETECTED
          : MIGRATION_CHECKSUM_REASON.VERIFIED,
      driftDetected: Boolean(migrationState.driftDetected),
      baselineMismatch,
      checkedVersions: migrationState.appliedVersions,
      manifestVersionCount: manifestCount,
      manifestChecksumBaseline: migrationState.checksumBaseline,
    },
  );

  const checksumBaseline = normalizeToken(migrationState.checksumBaseline)
    || checksumValidation.manifestChecksumBaseline
    || PLANNING_MIGRATION_CHECKSUM_BASELINE;

  const health = {
    contractVersion: PLANNING_PERSISTENCE_HEALTH_CONTRACT_VERSION,
    required: Boolean(validation.required),
    configured: Boolean(validation.configured),
    usable: Boolean(validation.usable),
    status,
    errors: normalizeDeterministicStringArray(validation.errors),
    lastError: normalizeToken(state.lastError, { lowerCase: false }),
    migrations: {
      schemaTable: normalizeToken(migrationState.schemaTable, { lowerCase: false }) || DEFAULT_SCHEMA_TABLE,
      latestVersion,
      manifestCount,
      checksumBaseline,
      baselineEnforced: migrationState.baselineEnforced !== false,
      baselineMismatch,
      appliedCount: normalizePositiveInteger(migrationState.appliedCount),
      appliedVersions: normalizeDeterministicStringArray(migrationState.appliedVersions),
      driftDetected: Boolean(migrationState.driftDetected),
      checksumValidation,
      lastRunAt: normalizeIsoTimestamp(migrationState.lastRunAt),
    },
  };

  return {
    ...health,
    governance: derivePlanningPersistenceGovernance(health),
  };
}

function normalizePlanningText(value) {
  const normalized = normalizeToken(value, { lowerCase: false });
  return normalized || '';
}

function normalizePlanningNumericScore(value) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRecordTimestamp(value) {
  if (value instanceof Date) {
    return normalizeIsoTimestamp(value.toISOString());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeIsoTimestamp(new Date(value).toISOString());
  }

  return normalizeIsoTimestamp(typeof value === 'string' ? value : null);
}

function normalizePlanningRecordForPersistence(record = {}) {
  const source = isPlainObject(record) ? record : {};
  const recordId = normalizeToken(source.recordId, { lowerCase: false });
  const scope = normalizeScope(source.scope);
  const ownerId = normalizeIdentity(source.ownerId);
  const repoId = normalizeIdentity(source.repoId);
  const state = normalizeToken(source.state) || 'thought';
  const createdAt = normalizeRecordTimestamp(source.createdAt) || new Date(0).toISOString();
  const updatedAt = normalizeRecordTimestamp(source.updatedAt) || createdAt;
  const acceptanceCriteria = Array.isArray(source.acceptanceCriteria)
    ? source.acceptanceCriteria
      .map((entry) => normalizePlanningText(entry))
      .filter(Boolean)
    : [];
  const acceptanceCriteriaText = normalizePlanningText(source.acceptanceCriteriaText);
  const targetRepoIds = Array.isArray(source.targetRepoIds)
    ? [...new Set(source.targetRepoIds.map((entry) => normalizeIdentity(entry)).filter(Boolean))].sort((left, right) => left.localeCompare(right))
    : [];

  if (!recordId || !scope || !ownerId) {
    return null;
  }

  if (scope === 'repo' && !repoId) {
    return null;
  }

  return {
    recordId,
    scope,
    ownerId,
    repoId: scope === 'repo' ? repoId : null,
    title: normalizePlanningText(source.title),
    summary: normalizePlanningText(source.summary),
    ...(acceptanceCriteria.length ? { acceptanceCriteria } : {}),
    ...(acceptanceCriteriaText ? { acceptanceCriteriaText } : {}),
    ...(targetRepoIds.length ? { targetRepoIds } : {}),
    state,
    score: normalizePlanningNumericScore(source.score),
    createdAt,
    updatedAt,
  };
}

function mapPersistedPlanningRecordRow(row) {
  if (!isPlainObject(row)) return null;

  const persistedState = isPlainObject(row.state) ? row.state : {};
  const record = normalizePlanningRecordForPersistence({
    recordId: normalizeToken(row.record_id, { lowerCase: false })
      || normalizeToken(persistedState.recordId, { lowerCase: false }),
    scope: normalizeScope(row.scope) || normalizeScope(persistedState.scope),
    ownerId: normalizeIdentity(row.owner_id) || normalizeIdentity(persistedState.ownerId),
    repoId: normalizeIdentity(row.repo_id) || normalizeIdentity(persistedState.repoId),
    title: Object.prototype.hasOwnProperty.call(persistedState, 'title') ? persistedState.title : row.title,
    summary: Object.prototype.hasOwnProperty.call(persistedState, 'summary') ? persistedState.summary : row.summary,
    acceptanceCriteria: Object.prototype.hasOwnProperty.call(persistedState, 'acceptanceCriteria')
      ? persistedState.acceptanceCriteria
      : row.acceptance_criteria,
    acceptanceCriteriaText: Object.prototype.hasOwnProperty.call(persistedState, 'acceptanceCriteriaText')
      ? persistedState.acceptanceCriteriaText
      : row.acceptance_criteria_text,
    targetRepoIds: Object.prototype.hasOwnProperty.call(persistedState, 'targetRepoIds')
      ? persistedState.targetRepoIds
      : row.target_repo_ids,
    state: Object.prototype.hasOwnProperty.call(persistedState, 'state') ? persistedState.state : row.state_token,
    score: Object.prototype.hasOwnProperty.call(persistedState, 'score') ? persistedState.score : row.score,
    createdAt: row.created_at || persistedState.createdAt,
    updatedAt: row.updated_at || persistedState.updatedAt,
  });

  return record;
}

function sortPlanningRecordsDeterministically(records = []) {
  const source = Array.isArray(records) ? records : [];
  return source.slice().sort((left, right) => {
    const ownerDiff = String(left && left.ownerId ? left.ownerId : '')
      .localeCompare(String(right && right.ownerId ? right.ownerId : ''));
    if (ownerDiff !== 0) return ownerDiff;

    const scopeDiff = String(left && left.scope ? left.scope : '')
      .localeCompare(String(right && right.scope ? right.scope : ''));
    if (scopeDiff !== 0) return scopeDiff;

    const repoDiff = String(left && left.repoId ? left.repoId : '')
      .localeCompare(String(right && right.repoId ? right.repoId : ''));
    if (repoDiff !== 0) return repoDiff;

    return String(left && left.recordId ? left.recordId : '')
      .localeCompare(String(right && right.recordId ? right.recordId : ''));
  });
}

async function readAllPersistedPlanningRecordRows(client) {
  ensureQueryClient(client);

  const result = await client.query(
    `
SELECT record_id, owner_id, repo_id, scope, state, created_at, updated_at
FROM ie_planning_records
ORDER BY owner_id ASC, scope ASC, repo_id ASC NULLS FIRST, record_id ASC
`,
  );

  return Array.isArray(result && result.rows) ? result.rows : [];
}

async function readPersistedPlanningRecordById(client, input = {}) {
  ensureQueryClient(client);

  const recordId = normalizeToken(input.recordId, { lowerCase: false });
  if (!recordId) return null;

  const result = await client.query(
    `
SELECT record_id, owner_id, repo_id, scope, state, created_at, updated_at
FROM ie_planning_records
WHERE record_id = $1
LIMIT 1
`,
    [recordId],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  return mapPersistedPlanningRecordRow(row);
}

function arePlanningRecordsEquivalent(left, right) {
  const normalizedLeft = normalizePlanningRecordForPersistence(left);
  const normalizedRight = normalizePlanningRecordForPersistence(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function normalizeRetentionMode(input = {}) {
  const mode = normalizeToken(input.mode);
  if (mode === 'execute') return 'execute';
  if (mode === 'dry-run' || mode === 'dry_run' || mode === 'dryrun') return 'dry-run';
  if (input.execute === true) return 'execute';
  if (input.dryRun === true) return 'dry-run';
  return 'dry-run';
}

function normalizeRetentionWindowDays(value) {
  return Math.min(36500, normalizePositiveInteger(value, 30));
}

function normalizeRetentionCutoffTimestamp(input = {}) {
  const explicitCutoff = normalizeIsoTimestamp(
    typeof input.cutoffUpdatedBefore === 'string'
      ? input.cutoffUpdatedBefore
      : null,
  );
  if (explicitCutoff) return explicitCutoff;

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const retentionWindowDays = normalizeRetentionWindowDays(input.olderThanDays);
  const cutoffMs = nowMs - (retentionWindowDays * 24 * 60 * 60 * 1000);
  return new Date(cutoffMs).toISOString();
}

async function runPlanningRetention(client, input = {}) {
  ensureQueryClient(client);

  const mode = normalizeRetentionMode(input);
  const cutoffUpdatedBefore = normalizeRetentionCutoffTimestamp(input);
  const olderThanDays = normalizeRetentionWindowDays(input.olderThanDays);

  const candidateResult = await client.query(
    `
SELECT record_id
FROM ie_planning_records
WHERE updated_at < $1::timestamptz
ORDER BY record_id ASC
`,
    [cutoffUpdatedBefore],
  );

  const candidateRecordIds = normalizeDeterministicStringArray(
    (Array.isArray(candidateResult && candidateResult.rows) ? candidateResult.rows : [])
      .map((row) => normalizeToken(row && row.record_id, { lowerCase: false }))
      .filter(Boolean),
  );

  let deletedRecordIds = [];
  if (mode === 'execute' && candidateRecordIds.length > 0) {
    const deleteResult = await client.query(
      `
DELETE FROM ie_planning_records
WHERE record_id = ANY($1::text[])
RETURNING record_id
`,
      [candidateRecordIds],
    );

    deletedRecordIds = normalizeDeterministicStringArray(
      (Array.isArray(deleteResult && deleteResult.rows) ? deleteResult.rows : [])
        .map((row) => normalizeToken(row && row.record_id, { lowerCase: false }))
        .filter(Boolean),
    );
  }

  return {
    ok: true,
    deterministic: true,
    mode,
    status: mode === 'execute' ? 'executed' : 'dry-run',
    retentionPolicy: {
      olderThanDays,
      cutoffUpdatedBefore,
    },
    candidateCount: candidateRecordIds.length,
    deletedCount: deletedRecordIds.length,
    candidateRecordIds,
    deletedRecordIds,
  };
}

function computePlanningSnapshotChecksum(records = []) {
  const canonical = JSON.stringify(sortPlanningRecordsDeterministically(records));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

async function exportPlanningPersistenceSnapshot(client, input = {}) {
  ensureQueryClient(client);

  const rows = await readAllPersistedPlanningRecordRows(client);
  const records = sortPlanningRecordsDeterministically(
    rows.map((row) => mapPersistedPlanningRecordRow(row)).filter(Boolean),
  );

  const exportedAt = normalizeIsoTimestamp(input.exportedAt)
    || new Date().toISOString();
  const checksum = computePlanningSnapshotChecksum(records);

  return {
    ok: true,
    deterministic: true,
    contractVersion: PLANNING_PERSISTENCE_SNAPSHOT_CONTRACT_VERSION,
    kind: 'planning.persistence.export',
    exportedAt,
    recordCount: records.length,
    checksum,
    records,
  };
}

async function importPlanningPersistenceSnapshot(client, input = {}) {
  ensureQueryClient(client);

  const source = isPlainObject(input) ? input : {};
  const snapshot = isPlainObject(source.snapshot) ? source.snapshot : source;
  const sourceRecords = Array.isArray(snapshot.records) ? snapshot.records : [];

  const dedupedByRecordId = new Map();
  const duplicateRecordIds = [];

  for (let index = 0; index < sourceRecords.length; index += 1) {
    const normalizedRecord = normalizePlanningRecordForPersistence(sourceRecords[index]);
    if (!normalizedRecord) {
      return {
        ok: false,
        deterministic: true,
        error: {
          code: 'planning_persistence_import_invalid_record',
          reason: 'record_shape_invalid',
          index,
        },
      };
    }

    const recordHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(normalizedRecord), 'utf8')
      .digest('hex');

    const existing = dedupedByRecordId.get(normalizedRecord.recordId);
    if (existing) {
      if (existing.recordHash !== recordHash) {
        return {
          ok: false,
          deterministic: true,
          error: {
            code: 'planning_persistence_import_conflicting_duplicate',
            reason: 'duplicate_record_id_conflict',
            recordId: normalizedRecord.recordId,
          },
        };
      }

      duplicateRecordIds.push(normalizedRecord.recordId);
      continue;
    }

    dedupedByRecordId.set(normalizedRecord.recordId, {
      normalizedRecord,
      recordHash,
    });
  }

  const importRecords = sortPlanningRecordsDeterministically(
    [...dedupedByRecordId.values()].map((entry) => entry.normalizedRecord),
  );

  let createdCount = 0;
  let updatedCount = 0;
  let replayedCount = 0;
  const importedRecordIds = [];

  for (const importRecord of importRecords) {
    const existingRecord = await readPersistedPlanningRecordById(client, {
      recordId: importRecord.recordId,
    });

    if (existingRecord && arePlanningRecordsEquivalent(existingRecord, importRecord)) {
      replayedCount += 1;
      importedRecordIds.push(importRecord.recordId);
      continue;
    }

    const persisted = await persistPlanningRecord(client, {
      actorId: importRecord.ownerId,
      record: importRecord,
    });

    if (!persisted.ok) {
      return {
        ok: false,
        deterministic: true,
        error: {
          code: 'planning_persistence_import_write_failed',
          reason: persisted.error && persisted.error.reason
            ? persisted.error.reason
            : 'import_write_failed',
          recordId: importRecord.recordId,
        },
      };
    }

    if (existingRecord) {
      updatedCount += 1;
    } else {
      createdCount += 1;
    }
    importedRecordIds.push(importRecord.recordId);
  }

  return {
    ok: true,
    deterministic: true,
    contractVersion: PLANNING_PERSISTENCE_SNAPSHOT_CONTRACT_VERSION,
    kind: 'planning.persistence.import',
    sourceRecordCount: sourceRecords.length,
    uniqueRecordCount: importRecords.length,
    duplicateRecordIds: normalizeDeterministicStringArray(duplicateRecordIds),
    importedCount: createdCount + updatedCount,
    createdCount,
    updatedCount,
    replayedCount,
    importedRecordIds: normalizeDeterministicStringArray(importedRecordIds),
  };
}

async function scanPlanningPersistenceCorruption(client) {
  ensureQueryClient(client);

  const rows = await readAllPersistedPlanningRecordRows(client);
  const findings = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const reasonCodes = [];
    const rawRecordId = normalizeToken(row && row.record_id, { lowerCase: false });
    const rawOwnerId = normalizeIdentity(row && row.owner_id);
    const rawScope = normalizeScope(row && row.scope);
    const rawRepoId = normalizeIdentity(row && row.repo_id);
    const createdAt = normalizeRecordTimestamp(row && row.created_at);
    const updatedAt = normalizeRecordTimestamp(row && row.updated_at);
    const mappedRecord = mapPersistedPlanningRecordRow(row);

    if (!mappedRecord) {
      reasonCodes.push('record_shape_invalid');
    } else {
      if (!rawRecordId) reasonCodes.push('record_id_missing');
      if (!rawOwnerId) reasonCodes.push('owner_id_missing');
      if (!rawScope) reasonCodes.push('scope_invalid');
      if (!createdAt) reasonCodes.push('created_at_invalid');
      if (!updatedAt) reasonCodes.push('updated_at_invalid');

      if (rawRecordId && rawRecordId !== mappedRecord.recordId) {
        reasonCodes.push('record_id_mismatch');
      }
      if (rawOwnerId && rawOwnerId !== mappedRecord.ownerId) {
        reasonCodes.push('owner_id_mismatch');
      }
      if (rawScope && rawScope !== mappedRecord.scope) {
        reasonCodes.push('scope_mismatch');
      }
      if (mappedRecord.scope === 'repo' && !rawRepoId) {
        reasonCodes.push('repo_id_missing_for_repo_scope');
      }
    }

    if (!reasonCodes.length) continue;

    findings.push({
      index,
      recordId: rawRecordId || (mappedRecord && mappedRecord.recordId) || null,
      code: 'planning_persistence_corruption_detected',
      reason: reasonCodes[0],
      reasonCodes: normalizeReasonCodes(reasonCodes),
    });
  }

  const blocked = findings.length > 0;
  return {
    ok: true,
    deterministic: true,
    kind: 'planning.persistence.corruption.scan',
    scannedAt: new Date().toISOString(),
    totalRows: rows.length,
    findingCount: findings.length,
    blocked,
    recoveryRequired: blocked,
    code: blocked
      ? 'planning_persistence_corruption_detected'
      : 'planning_persistence_corruption_clear',
    reason: blocked ? 'corruption_detected' : 'no_corruption_detected',
    findings,
  };
}

function deriveNextPlanningRecordNumber(records = []) {
  let maxRecordNumber = 0;
  const source = Array.isArray(records) ? records : [];

  for (const record of source) {
    if (!record || typeof record !== 'object') continue;
    const match = /^planning-(\d+)$/.exec(String(record.recordId || '').trim());
    if (!match) continue;
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric) && numeric > maxRecordNumber) {
      maxRecordNumber = numeric;
    }
  }

  return maxRecordNumber + 1;
}

async function listPersistedPlanningRecords(client, input = {}) {
  ensureQueryClient(client);

  const actorId = normalizeIdentity(input.actorId || input.userId || input.ownerId);
  if (!actorId) {
    return {
      ok: false,
      error: {
        code: 'scope_visibility_denied',
        reason: 'missing_user_context',
      },
      records: [],
      nextRecordNumber: 1,
    };
  }

  const requestedScopes = Array.isArray(input.scopes) && input.scopes.length
    ? [...new Set(input.scopes.map((scope) => normalizeScope(scope)).filter(Boolean))]
    : ['repo', 'user', 'global'];

  const repoId = normalizeIdentity(input.repoId);
  const result = await client.query(
    `
SELECT record_id, owner_id, repo_id, scope, state, created_at, updated_at
FROM ie_planning_records
WHERE owner_id = $1
ORDER BY updated_at DESC, created_at DESC, record_id ASC
`,
    [actorId],
  );

  const rows = Array.isArray(result && result.rows) ? result.rows : [];
  const records = [];

  for (const row of rows) {
    const mapped = mapPersistedPlanningRecordRow(row);
    if (!mapped) continue;
    if (!requestedScopes.includes(mapped.scope)) continue;
    if (mapped.scope === 'repo' && repoId && mapped.repoId !== repoId) continue;
    records.push(mapped);
  }

  return {
    ok: true,
    records,
    nextRecordNumber: deriveNextPlanningRecordNumber(records),
  };
}

async function persistPlanningRecord(client, input = {}) {
  ensureQueryClient(client);

  const actorId = normalizeIdentity(input.actorId || input.userId || input.ownerId);
  const normalizedRecord = normalizePlanningRecordForPersistence(input.record);

  if (!normalizedRecord) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_record',
        reason: 'record_shape_invalid',
      },
    };
  }

  const writeContext = validatePlanningReadWriteContext({
    action: 'write',
    scope: normalizedRecord.scope,
    actorId,
    ownerId: normalizedRecord.ownerId,
    repoId: normalizedRecord.repoId,
  });

  if (!writeContext.ok) {
    return {
      ok: false,
      error: writeContext.error,
    };
  }

  const persistedPayload = {
    ...normalizedRecord,
  };

  const result = await client.query(
    `
INSERT INTO ie_planning_records (record_id, owner_id, repo_id, scope, state, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
ON CONFLICT (record_id)
DO UPDATE SET
  owner_id = EXCLUDED.owner_id,
  repo_id = EXCLUDED.repo_id,
  scope = EXCLUDED.scope,
  state = EXCLUDED.state,
  updated_at = EXCLUDED.updated_at
RETURNING record_id, owner_id, repo_id, scope, state, created_at, updated_at
`,
    [
      normalizedRecord.recordId,
      normalizedRecord.ownerId,
      normalizedRecord.repoId,
      normalizedRecord.scope,
      JSON.stringify(persistedPayload),
      normalizedRecord.createdAt,
      normalizedRecord.updatedAt,
    ],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  return {
    ok: true,
    record: mapPersistedPlanningRecordRow(row) || normalizedRecord,
  };
}

function normalizePlanningCompareReceiptForPersistence(receipt = {}) {
  const source = isPlainObject(receipt) ? receipt : {};

  const receiptId = normalizeToken(source.receiptId, { lowerCase: false });
  const actorId = normalizeIdentity(source.actorId);
  const repoId = normalizeIdentity(source.repoId);
  const compareHash = normalizeToken(source.compareHash, { lowerCase: false });
  const sourceIdsHash = normalizeToken(source.sourceIdsHash, { lowerCase: false });
  const sourceIds = normalizeDeterministicStringArray(source.sourceIds);
  const versionVector = isPlainObject(source.versionVector) ? source.versionVector : null;
  const gateState = normalizeToken(source.gateState, { lowerCase: false });
  const mergeEligible = source.mergeEligible === true;
  const reason = normalizeToken(source.reason, { lowerCase: false });
  const downgrade = isPlainObject(source.downgrade) ? source.downgrade : null;
  const issuedAt = normalizeIsoTimestamp(source.issuedAt);
  const expiresAt = normalizeIsoTimestamp(source.expiresAt);

  if (!receiptId || !actorId || !compareHash || !sourceIdsHash || !gateState || !reason || !issuedAt || !expiresAt) {
    return null;
  }

  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    return null;
  }

  return {
    receiptId,
    actorId,
    repoId,
    compareHash,
    sourceIdsHash,
    sourceIds,
    versionVector,
    gateState,
    mergeEligible,
    reason,
    downgrade,
    issuedAt,
    expiresAt,
  };
}

function mapPersistedPlanningCompareReceiptRow(row) {
  if (!isPlainObject(row)) return null;

  return normalizePlanningCompareReceiptForPersistence({
    receiptId: row.receipt_id,
    actorId: row.actor_id,
    repoId: row.repo_id,
    compareHash: row.compare_hash,
    sourceIdsHash: row.source_ids_hash,
    sourceIds: Array.isArray(row.source_ids) ? row.source_ids : [],
    versionVector: isPlainObject(row.version_vector) ? row.version_vector : null,
    gateState: row.gate_state,
    mergeEligible: row.merge_eligible === true,
    reason: row.reason,
    downgrade: isPlainObject(row.downgrade) ? row.downgrade : null,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  });
}

async function persistPlanningCompareReceipt(client, input = {}) {
  ensureQueryClient(client);

  const normalized = normalizePlanningCompareReceiptForPersistence(input.receipt);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: 'invalid_compare_receipt',
        reason: 'compare_receipt_shape_invalid',
      },
    };
  }

  const result = await client.query(
    `
INSERT INTO ie_planning_compare_receipts (
  receipt_id,
  actor_id,
  repo_id,
  compare_hash,
  source_ids_hash,
  source_ids,
  version_vector,
  gate_state,
  merge_eligible,
  reason,
  downgrade,
  issued_at,
  expires_at
)
VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11::jsonb, $12::timestamptz, $13::timestamptz)
ON CONFLICT (receipt_id)
DO UPDATE SET
  actor_id = EXCLUDED.actor_id,
  repo_id = EXCLUDED.repo_id,
  compare_hash = EXCLUDED.compare_hash,
  source_ids_hash = EXCLUDED.source_ids_hash,
  source_ids = EXCLUDED.source_ids,
  version_vector = EXCLUDED.version_vector,
  gate_state = EXCLUDED.gate_state,
  merge_eligible = EXCLUDED.merge_eligible,
  reason = EXCLUDED.reason,
  downgrade = EXCLUDED.downgrade,
  issued_at = EXCLUDED.issued_at,
  expires_at = EXCLUDED.expires_at
RETURNING receipt_id, actor_id, repo_id, compare_hash, source_ids_hash, source_ids, version_vector, gate_state, merge_eligible, reason, downgrade, issued_at, expires_at
`,
    [
      normalized.receiptId,
      normalized.actorId,
      normalized.repoId,
      normalized.compareHash,
      normalized.sourceIdsHash,
      JSON.stringify(normalized.sourceIds),
      JSON.stringify(normalized.versionVector),
      normalized.gateState,
      normalized.mergeEligible,
      normalized.reason,
      JSON.stringify(normalized.downgrade),
      normalized.issuedAt,
      normalized.expiresAt,
    ],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  return {
    ok: true,
    receipt: mapPersistedPlanningCompareReceiptRow(row) || normalized,
  };
}

async function readPlanningCompareReceipt(client, input = {}) {
  ensureQueryClient(client);

  const receiptId = normalizeToken(input.receiptId, { lowerCase: false });
  if (!receiptId) {
    return {
      ok: false,
      error: {
        code: 'invalid_compare_receipt',
        reason: 'missing_compare_receipt_id',
      },
    };
  }

  const result = await client.query(
    `
SELECT receipt_id, actor_id, repo_id, compare_hash, source_ids_hash, source_ids, version_vector, gate_state, merge_eligible, reason, downgrade, issued_at, expires_at
FROM ie_planning_compare_receipts
WHERE receipt_id = $1
LIMIT 1
`,
    [receiptId],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  if (!row) {
    return {
      ok: false,
      error: {
        code: 'invalid_compare_receipt',
        reason: 'compare_receipt_not_found',
      },
    };
  }

  const receipt = mapPersistedPlanningCompareReceiptRow(row);
  if (!receipt) {
    return {
      ok: false,
      error: {
        code: 'invalid_compare_receipt',
        reason: 'compare_receipt_corrupt',
      },
    };
  }

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  if (nowMs > Date.parse(receipt.expiresAt)) {
    await client.query(
      `
DELETE FROM ie_planning_compare_receipts
WHERE receipt_id = $1
`,
      [receiptId],
    );

    return {
      ok: false,
      expired: true,
      error: {
        code: 'invalid_compare_receipt',
        reason: 'compare_receipt_expired',
      },
    };
  }

  return {
    ok: true,
    receipt,
  };
}

function normalizePlanningMergeIntentForPersistence(token = {}) {
  const source = isPlainObject(token) ? token : {};

  const tokenId = normalizeToken(source.tokenId, { lowerCase: false });
  const compareReceiptId = normalizeToken(source.compareReceiptId, { lowerCase: false });
  const actorId = normalizeIdentity(source.actorId);
  const repoId = normalizeIdentity(source.repoId);
  const targetId = normalizeToken(source.targetId, { lowerCase: false });
  const sourceIdsHash = normalizeToken(source.sourceIdsHash, { lowerCase: false });
  const compareHash = normalizeToken(source.compareHash, { lowerCase: false });
  const versionVector = isPlainObject(source.versionVector) ? source.versionVector : null;
  const versionVectorHash = normalizeToken(source.versionVectorHash, { lowerCase: false });
  const issuedAt = normalizeIsoTimestamp(source.issuedAt);
  const expiresAt = normalizeIsoTimestamp(source.expiresAt);
  const consumedAt = normalizeIsoTimestamp(source.consumedAt);

  if (!tokenId || !compareReceiptId || !actorId || !targetId || !sourceIdsHash || !compareHash || !issuedAt || !expiresAt) {
    return null;
  }

  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    return null;
  }

  return {
    tokenId,
    compareReceiptId,
    actorId,
    repoId,
    targetId,
    sourceIdsHash,
    compareHash,
    versionVector,
    versionVectorHash,
    issuedAt,
    expiresAt,
    consumedAt,
  };
}

function mapPersistedPlanningMergeIntentRow(row) {
  if (!isPlainObject(row)) return null;

  return normalizePlanningMergeIntentForPersistence({
    tokenId: row.token_id,
    compareReceiptId: row.compare_receipt_id,
    actorId: row.actor_id,
    repoId: row.repo_id,
    targetId: row.target_id,
    sourceIdsHash: row.source_ids_hash,
    compareHash: row.compare_hash,
    versionVector: isPlainObject(row.version_vector) ? row.version_vector : null,
    versionVectorHash: row.version_vector_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  });
}

async function persistPlanningMergeIntent(client, input = {}) {
  ensureQueryClient(client);

  const normalized = normalizePlanningMergeIntentForPersistence(input.token);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: 'invalid_confirmation_token',
        reason: 'token_shape_invalid',
      },
    };
  }

  const result = await client.query(
    `
INSERT INTO ie_planning_merge_intents (
  token_id,
  compare_receipt_id,
  actor_id,
  repo_id,
  target_id,
  source_ids_hash,
  compare_hash,
  version_vector,
  version_vector_hash,
  issued_at,
  expires_at,
  consumed_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::timestamptz, $11::timestamptz, $12::timestamptz)
ON CONFLICT (token_id)
DO UPDATE SET
  compare_receipt_id = EXCLUDED.compare_receipt_id,
  actor_id = EXCLUDED.actor_id,
  repo_id = EXCLUDED.repo_id,
  target_id = EXCLUDED.target_id,
  source_ids_hash = EXCLUDED.source_ids_hash,
  compare_hash = EXCLUDED.compare_hash,
  version_vector = EXCLUDED.version_vector,
  version_vector_hash = EXCLUDED.version_vector_hash,
  issued_at = EXCLUDED.issued_at,
  expires_at = EXCLUDED.expires_at,
  consumed_at = EXCLUDED.consumed_at
RETURNING token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash, compare_hash, version_vector, version_vector_hash, issued_at, expires_at, consumed_at
`,
    [
      normalized.tokenId,
      normalized.compareReceiptId,
      normalized.actorId,
      normalized.repoId,
      normalized.targetId,
      normalized.sourceIdsHash,
      normalized.compareHash,
      JSON.stringify(normalized.versionVector),
      normalized.versionVectorHash,
      normalized.issuedAt,
      normalized.expiresAt,
      normalized.consumedAt,
    ],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  return {
    ok: true,
    token: mapPersistedPlanningMergeIntentRow(row) || normalized,
  };
}

async function readPlanningMergeIntent(client, input = {}) {
  ensureQueryClient(client);

  const tokenId = normalizeToken(input.tokenId, { lowerCase: false });
  if (!tokenId) {
    return {
      ok: false,
      error: {
        code: 'invalid_confirmation_token',
        reason: 'missing_or_invalid_token_id',
      },
    };
  }

  const result = await client.query(
    `
SELECT token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash, compare_hash, version_vector, version_vector_hash, issued_at, expires_at, consumed_at
FROM ie_planning_merge_intents
WHERE token_id = $1
LIMIT 1
`,
    [tokenId],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  if (!row) {
    return {
      ok: false,
      error: {
        code: 'invalid_confirmation_token',
        reason: 'token_not_found',
      },
    };
  }

  const token = mapPersistedPlanningMergeIntentRow(row);
  if (!token) {
    return {
      ok: false,
      error: {
        code: 'invalid_confirmation_token',
        reason: 'token_shape_invalid',
      },
    };
  }

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  if (nowMs > Date.parse(token.expiresAt)) {
    await client.query(
      `
DELETE FROM ie_planning_merge_intents
WHERE token_id = $1
`,
      [tokenId],
    );

    return {
      ok: false,
      expired: true,
      error: {
        code: 'invalid_confirmation_token',
        reason: 'token_expired',
      },
    };
  }

  return {
    ok: true,
    token,
  };
}

async function consumePlanningMergeIntent(client, input = {}) {
  ensureQueryClient(client);

  const tokenId = normalizeToken(input.tokenId, { lowerCase: false });
  const consumedAt = normalizeIsoTimestamp(input.consumedAt) || new Date().toISOString();

  if (!tokenId) {
    return {
      ok: false,
      error: {
        code: 'invalid_confirmation_token',
        reason: 'missing_or_invalid_token_id',
      },
    };
  }

  const updateResult = await client.query(
    `
UPDATE ie_planning_merge_intents
SET consumed_at = $2::timestamptz
WHERE token_id = $1
  AND consumed_at IS NULL
RETURNING token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash, compare_hash, version_vector, version_vector_hash, issued_at, expires_at, consumed_at
`,
    [tokenId, consumedAt],
  );

  const updatedRow = Array.isArray(updateResult && updateResult.rows) ? updateResult.rows[0] : null;
  if (updatedRow) {
    return {
      ok: true,
      token: mapPersistedPlanningMergeIntentRow(updatedRow),
    };
  }

  const existing = await readPlanningMergeIntent(client, {
    tokenId,
    nowMs: Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now(),
  });

  if (!existing.ok) {
    return existing;
  }

  return {
    ok: false,
    error: {
      code: 'invalid_confirmation_token',
      reason: 'token_consumed',
    },
  };
}

async function resetPlanningMergeIntentConsumption(client, input = {}) {
  ensureQueryClient(client);

  const tokenId = normalizeToken(input.tokenId, { lowerCase: false });
  if (!tokenId) {
    return {
      ok: false,
      error: {
        code: 'invalid_confirmation_token',
        reason: 'missing_or_invalid_token_id',
      },
    };
  }

  const result = await client.query(
    `
UPDATE ie_planning_merge_intents
SET consumed_at = NULL
WHERE token_id = $1
RETURNING token_id
`,
    [tokenId],
  );

  return {
    ok: true,
    reset: Number(result && result.rowCount) > 0,
  };
}

function normalizePlanningSuggestionForPersistence(suggestion = {}) {
  const source = isPlainObject(suggestion) ? suggestion : {};
  const suggestionId = normalizeToken(source.suggestionId, { lowerCase: false });
  const actorId = normalizeIdentity(source.actorId);
  const repoId = normalizeIdentity(source.repoId);
  const scope = normalizeScope(source.scope);
  const state = isPlainObject(source.state) ? source.state : null;
  const createdAt = normalizeRecordTimestamp(source.createdAt) || new Date(0).toISOString();
  const updatedAt = normalizeRecordTimestamp(source.updatedAt) || createdAt;

  if (!suggestionId || !actorId || !scope || !state) {
    return null;
  }

  if (scope === 'repo' && !repoId) {
    return null;
  }

  return {
    suggestionId,
    actorId,
    repoId: scope === 'repo' ? repoId : null,
    scope,
    state,
    createdAt,
    updatedAt,
  };
}

function mapPersistedPlanningSuggestionRow(row) {
  if (!isPlainObject(row)) return null;

  return normalizePlanningSuggestionForPersistence({
    suggestionId: row.suggestion_id,
    actorId: row.actor_id,
    repoId: row.repo_id,
    scope: row.scope,
    state: isPlainObject(row.state) ? row.state : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function persistPlanningSuggestion(client, input = {}) {
  ensureQueryClient(client);

  const normalized = normalizePlanningSuggestionForPersistence(input.suggestion);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_suggestion',
        reason: 'planning_suggestion_shape_invalid',
      },
    };
  }

  const writeContext = validatePlanningReadWriteContext({
    action: 'write',
    scope: normalized.scope,
    actorId: normalizeIdentity(input.actorId || input.userId || normalized.actorId),
    ownerId: normalized.actorId,
    repoId: normalized.repoId,
  });

  if (!writeContext.ok) {
    return {
      ok: false,
      error: writeContext.error,
    };
  }

  const result = await client.query(
    `
INSERT INTO ie_planning_suggestions (
  suggestion_id,
  actor_id,
  repo_id,
  scope,
  state,
  created_at,
  updated_at
)
VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
ON CONFLICT (suggestion_id)
DO UPDATE SET
  actor_id = EXCLUDED.actor_id,
  repo_id = EXCLUDED.repo_id,
  scope = EXCLUDED.scope,
  state = EXCLUDED.state,
  updated_at = EXCLUDED.updated_at
WHERE ie_planning_suggestions.actor_id = EXCLUDED.actor_id
RETURNING suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at
`,
    [
      normalized.suggestionId,
      normalized.actorId,
      normalized.repoId,
      normalized.scope,
      JSON.stringify(normalized.state),
      normalized.createdAt,
      normalized.updatedAt,
    ],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  if (!row) {
    return {
      ok: false,
      error: {
        code: 'scope_visibility_denied',
        reason: 'ownership_conflict',
      },
    };
  }

  return {
    ok: true,
    suggestion: mapPersistedPlanningSuggestionRow(row) || normalized,
  };
}

async function readPlanningSuggestion(client, input = {}) {
  ensureQueryClient(client);

  const suggestionId = normalizeToken(input.suggestionId, { lowerCase: false });
  const actorId = normalizeIdentity(input.actorId || input.userId);

  if (!suggestionId) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_suggestion',
        reason: 'missing_suggestion_id',
      },
    };
  }

  if (!actorId) {
    return {
      ok: false,
      error: {
        code: 'scope_visibility_denied',
        reason: 'missing_user_context',
      },
    };
  }

  const result = await client.query(
    `
SELECT suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at
FROM ie_planning_suggestions
WHERE suggestion_id = $1
LIMIT 1
`,
    [suggestionId],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  if (!row) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_suggestion',
        reason: 'planning_suggestion_not_found',
      },
    };
  }

  const suggestion = mapPersistedPlanningSuggestionRow(row);
  if (!suggestion) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_suggestion',
        reason: 'planning_suggestion_corrupt',
      },
    };
  }

  const readContext = validatePlanningReadWriteContext({
    action: 'read',
    scope: suggestion.scope,
    actorId,
    ownerId: suggestion.actorId,
    repoId: suggestion.repoId,
  });

  if (!readContext.ok) {
    return {
      ok: false,
      error: readContext.error,
    };
  }

  return {
    ok: true,
    suggestion,
  };
}

function normalizePlanningRecapForPersistence(recap = {}) {
  const source = isPlainObject(recap) ? recap : {};
  const recapId = normalizeToken(source.recapId, { lowerCase: false });
  const actorId = normalizeIdentity(source.actorId);
  const repoId = normalizeIdentity(source.repoId);
  const scope = normalizeScope(source.scope);
  const state = isPlainObject(source.state) ? source.state : null;
  const createdAt = normalizeRecordTimestamp(source.createdAt) || new Date(0).toISOString();
  const updatedAt = normalizeRecordTimestamp(source.updatedAt) || createdAt;

  if (!recapId || !actorId || !scope || !state) {
    return null;
  }

  if (scope === 'repo' && !repoId) {
    return null;
  }

  return {
    recapId,
    actorId,
    repoId: scope === 'repo' ? repoId : null,
    scope,
    state,
    createdAt,
    updatedAt,
  };
}

function mapPersistedPlanningRecapRow(row) {
  if (!isPlainObject(row)) return null;

  return normalizePlanningRecapForPersistence({
    recapId: row.recap_id,
    actorId: row.actor_id,
    repoId: row.repo_id,
    scope: row.scope,
    state: isPlainObject(row.state) ? row.state : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function persistPlanningRecap(client, input = {}) {
  ensureQueryClient(client);

  const normalized = normalizePlanningRecapForPersistence(input.recap);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_recap',
        reason: 'planning_recap_shape_invalid',
      },
    };
  }

  const writeContext = validatePlanningReadWriteContext({
    action: 'write',
    scope: normalized.scope,
    actorId: normalizeIdentity(input.actorId || input.userId || normalized.actorId),
    ownerId: normalized.actorId,
    repoId: normalized.repoId,
  });

  if (!writeContext.ok) {
    return {
      ok: false,
      error: writeContext.error,
    };
  }

  const result = await client.query(
    `
INSERT INTO ie_planning_recaps (
  recap_id,
  actor_id,
  repo_id,
  scope,
  state,
  created_at,
  updated_at
)
VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
ON CONFLICT (recap_id)
DO UPDATE SET
  actor_id = EXCLUDED.actor_id,
  repo_id = EXCLUDED.repo_id,
  scope = EXCLUDED.scope,
  state = EXCLUDED.state,
  updated_at = EXCLUDED.updated_at
WHERE ie_planning_recaps.actor_id = EXCLUDED.actor_id
RETURNING recap_id, actor_id, repo_id, scope, state, created_at, updated_at
`,
    [
      normalized.recapId,
      normalized.actorId,
      normalized.repoId,
      normalized.scope,
      JSON.stringify(normalized.state),
      normalized.createdAt,
      normalized.updatedAt,
    ],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  if (!row) {
    return {
      ok: false,
      error: {
        code: 'scope_visibility_denied',
        reason: 'ownership_conflict',
      },
    };
  }

  return {
    ok: true,
    recap: mapPersistedPlanningRecapRow(row) || normalized,
  };
}

async function readPlanningRecap(client, input = {}) {
  ensureQueryClient(client);

  const recapId = normalizeToken(input.recapId, { lowerCase: false });
  const actorId = normalizeIdentity(input.actorId || input.userId);

  if (!recapId) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_recap',
        reason: 'missing_recap_id',
      },
    };
  }

  if (!actorId) {
    return {
      ok: false,
      error: {
        code: 'scope_visibility_denied',
        reason: 'missing_user_context',
      },
    };
  }

  const result = await client.query(
    `
SELECT recap_id, actor_id, repo_id, scope, state, created_at, updated_at
FROM ie_planning_recaps
WHERE recap_id = $1
LIMIT 1
`,
    [recapId],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  if (!row) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_recap',
        reason: 'planning_recap_not_found',
      },
    };
  }

  const recap = mapPersistedPlanningRecapRow(row);
  if (!recap) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_recap',
        reason: 'planning_recap_corrupt',
      },
    };
  }

  const readContext = validatePlanningReadWriteContext({
    action: 'read',
    scope: recap.scope,
    actorId,
    ownerId: recap.actorId,
    repoId: recap.repoId,
  });

  if (!readContext.ok) {
    return {
      ok: false,
      error: readContext.error,
    };
  }

  return {
    ok: true,
    recap,
  };
}

function mapPersistedPlanningMergeIdempotencyRow(row) {
  if (!isPlainObject(row)) return null;

  const idempotencyKey = normalizeToken(row.idempotency_key, { lowerCase: false });
  const actorId = normalizeIdentity(row.actor_id);
  const repoId = normalizeIdentity(row.repo_id);
  const operationType = normalizeToken(row.operation_type, { lowerCase: false });
  const targetId = normalizeToken(row.target_id, { lowerCase: false });
  const sourceIdsHash = normalizeToken(row.source_ids_hash, { lowerCase: false });
  const compareHash = normalizeToken(row.compare_hash, { lowerCase: false });
  const payloadHash = normalizeToken(row.payload_hash, { lowerCase: false });
  const mergeRecordId = normalizeToken(row.merge_record_id, { lowerCase: false });
  const response = isPlainObject(row.response) ? row.response : {};
  const createdAt = normalizeIsoTimestamp(row.created_at);
  const expiresAt = normalizeIsoTimestamp(row.expires_at);

  if (!idempotencyKey || !actorId || !operationType || !targetId || !sourceIdsHash || !compareHash || !payloadHash || !createdAt || !expiresAt) {
    return null;
  }

  return {
    idempotencyKey,
    actorId,
    repoId,
    operationType,
    targetId,
    sourceIdsHash,
    compareHash,
    payloadHash,
    mergeRecordId: mergeRecordId || null,
    response,
    createdAt,
    expiresAt,
  };
}

async function readPlanningMergeIdempotencyRecord(client, input = {}) {
  ensureQueryClient(client);

  const idempotencyKey = normalizeToken(input.idempotencyKey, { lowerCase: false });
  if (!idempotencyKey) {
    return {
      ok: false,
      error: {
        code: 'invalid_idempotency',
        reason: 'missing_or_invalid_idempotency_key',
      },
    };
  }

  const result = await client.query(
    `
SELECT idempotency_key, actor_id, repo_id, operation_type, target_id, source_ids_hash, compare_hash, payload_hash, merge_record_id, response, created_at, expires_at
FROM ie_planning_merge_idempotency_ledger
WHERE idempotency_key = $1
LIMIT 1
`,
    [idempotencyKey],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  if (!row) {
    return {
      ok: true,
      record: null,
    };
  }

  const record = mapPersistedPlanningMergeIdempotencyRow(row);
  if (!record) {
    return {
      ok: false,
      error: {
        code: 'invalid_idempotency',
        reason: 'idempotency_record_corrupt',
      },
    };
  }

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  if (nowMs > Date.parse(record.expiresAt)) {
    await client.query(
      `
DELETE FROM ie_planning_merge_idempotency_ledger
WHERE idempotency_key = $1
`,
      [idempotencyKey],
    );

    return {
      ok: true,
      expired: true,
      record: null,
    };
  }

  return {
    ok: true,
    record,
  };
}

async function persistPlanningMergeIdempotencyRecord(client, input = {}) {
  ensureQueryClient(client);

  const idempotencyKey = normalizeToken(input.idempotencyKey, { lowerCase: false });
  const actorId = normalizeIdentity(input.actorId);
  const repoId = normalizeIdentity(input.repoId);
  const operationType = normalizeToken(input.operationType, { lowerCase: false }) || 'merge';
  const targetId = normalizeToken(input.targetId, { lowerCase: false });
  const sourceIdsHash = normalizeToken(input.sourceIdsHash, { lowerCase: false });
  const compareHash = normalizeToken(input.compareHash, { lowerCase: false });
  const payloadHash = normalizeToken(input.payloadHash, { lowerCase: false });
  const mergeRecordId = normalizeToken(input.mergeRecordId, { lowerCase: false });
  const response = isPlainObject(input.response) ? input.response : {};
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const ttlMs = Number.isFinite(input.ttlMs)
    ? Math.max(1_000, Math.floor(Number(input.ttlMs)))
    : 60 * 60 * 1000;
  const expiresAt = new Date(nowMs + ttlMs).toISOString();

  if (!idempotencyKey || !actorId || !targetId || !sourceIdsHash || !compareHash || !payloadHash) {
    return {
      ok: false,
      error: {
        code: 'invalid_idempotency',
        reason: 'idempotency_record_shape_invalid',
      },
    };
  }

  const existing = await readPlanningMergeIdempotencyRecord(client, {
    idempotencyKey,
    nowMs,
  });

  if (!existing.ok) {
    return existing;
  }

  if (existing.record) {
    if (String(existing.record.payloadHash || '') !== payloadHash) {
      return {
        ok: false,
        conflict: true,
        error: {
          code: 'idempotency_conflict',
          reason: 'idempotency_key_payload_mismatch',
        },
      };
    }

    return {
      ok: true,
      replay: true,
      record: existing.record,
    };
  }

  const result = await client.query(
    `
INSERT INTO ie_planning_merge_idempotency_ledger (
  idempotency_key,
  actor_id,
  repo_id,
  operation_type,
  target_id,
  source_ids_hash,
  compare_hash,
  payload_hash,
  merge_record_id,
  response,
  expires_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz)
RETURNING idempotency_key, actor_id, repo_id, operation_type, target_id, source_ids_hash, compare_hash, payload_hash, merge_record_id, response, created_at, expires_at
`,
    [
      idempotencyKey,
      actorId,
      repoId,
      operationType,
      targetId,
      sourceIdsHash,
      compareHash,
      payloadHash,
      mergeRecordId,
      JSON.stringify(response),
      expiresAt,
    ],
  );

  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  return {
    ok: true,
    replay: false,
    record: mapPersistedPlanningMergeIdempotencyRow(row),
  };
}

async function deletePlanningMergeIdempotencyRecord(client, input = {}) {
  ensureQueryClient(client);

  const idempotencyKey = normalizeToken(input.idempotencyKey, { lowerCase: false });
  if (!idempotencyKey) {
    return {
      ok: false,
      error: {
        code: 'invalid_idempotency',
        reason: 'missing_or_invalid_idempotency_key',
      },
    };
  }

  const result = await client.query(
    `
DELETE FROM ie_planning_merge_idempotency_ledger
WHERE idempotency_key = $1
RETURNING idempotency_key
`,
    [idempotencyKey],
  );

  return {
    ok: true,
    deleted: Number(result && result.rowCount) > 0,
  };
}

async function deletePersistedPlanningRecordById(client, input = {}) {
  ensureQueryClient(client);

  const recordId = normalizeToken(input.recordId, { lowerCase: false });
  if (!recordId) {
    return {
      ok: false,
      error: {
        code: 'invalid_planning_record',
        reason: 'missing_or_invalid_record_id',
      },
    };
  }

  const actorId = normalizeIdentity(input.actorId || input.userId || input.ownerId);
  if (!actorId) {
    return {
      ok: false,
      error: {
        code: 'scope_visibility_denied',
        reason: 'missing_user_context',
      },
    };
  }

  const existing = await readPersistedPlanningRecordById(client, { recordId });
  if (!existing) {
    return {
      ok: true,
      deleted: false,
      recordId,
    };
  }

  const writeContext = validatePlanningReadWriteContext({
    action: 'write',
    scope: existing.scope,
    actorId,
    ownerId: existing.ownerId,
    repoId: existing.repoId,
  });

  if (!writeContext.ok) {
    return {
      ok: false,
      error: writeContext.error,
    };
  }

  const result = await client.query(
    `
DELETE FROM ie_planning_records
WHERE record_id = $1
RETURNING record_id
`,
    [recordId],
  );

  return {
    ok: true,
    deleted: Number(result && result.rowCount) > 0,
    recordId,
  };
}

module.exports = {
  BACKFILL_ITEM_STATUS,
  BACKFILL_RECOVERY_MARKERS,
  DEFAULT_SCHEMA_TABLE,
  PLANNING_PERSISTENCE_HEALTH_CONTRACT_VERSION,
  PLANNING_PROVIDER_STATE_CONTRACT_VERSION,
  PLANNING_PERSISTENCE_SNAPSHOT_CONTRACT_VERSION,
  PLANNING_WS5A_DURABILITY_REQUIRED_MIGRATION_VERSIONS,
  PLANNING_WS5A_DURABILITY_ARTIFACT_TABLES,
  PLANNING_MIGRATION_MANIFEST,
  PLANNING_MIGRATION_CHECKSUM_BASELINE,
  buildPlanningProviderStatePersistencePayload,
  buildPlanningScopeIsolationPredicate,
  computeManifestChecksumBaseline,
  computeMigrationChecksum,
  deriveBackfillRecoveryMarker,
  deriveBackfillSourceIdempotencyKey,
  evaluatePlanningOptimisticConcurrencyGuard,
  readPlanningProviderState,
  readPlanningPersistenceConfig,
  reconcileBackfillItemStatusTransition,
  normalizePlanningRecordForPersistence,
  mapPersistedPlanningRecordRow,
  sortPlanningRecordsDeterministically,
  deriveNextPlanningRecordNumber,
  listPersistedPlanningRecords,
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
  readPlanningMergeIdempotencyRecord,
  persistPlanningMergeIdempotencyRecord,
  deletePlanningMergeIdempotencyRecord,
  deletePersistedPlanningRecordById,
  runPlanningRetention,
  exportPlanningPersistenceSnapshot,
  importPlanningPersistenceSnapshot,
  scanPlanningPersistenceCorruption,
  persistPlanningRecord,
  validatePlanningPersistenceConfig,
  validatePlanningReadWriteContext,
  getPlanningPersistenceHealth,
  runPlanningMigrations,
};
