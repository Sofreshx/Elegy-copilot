'use strict';

const assert = require('assert');
const {
  PLANNING_PROVIDER_STATE_CONTRACT_VERSION,
  PLANNING_MIGRATION_MANIFEST,
  buildPlanningProviderStatePersistencePayload,
  buildPlanningScopeIsolationPredicate,
  deriveNextPlanningRecordNumber,
  deriveBackfillSourceIdempotencyKey,
  evaluatePlanningOptimisticConcurrencyGuard,
  listPersistedPlanningRecords,
  normalizePlanningRecordForPersistence,
  persistPlanningRecord,
  readPlanningProviderState,
  reconcileBackfillItemStatusTransition,
  readPlanningPersistenceConfig,
  validatePlanningPersistenceConfig,
  validatePlanningReadWriteContext,
  getPlanningPersistenceHealth,
  runPlanningMigrations,
} = require('./planningPersistence');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

function createMockClient(options = {}) {
  const initialVersions = Array.isArray(options.initialVersions) ? options.initialVersions : [];
  const schemaVersions = new Map();
  const appliedMigrationStatements = [];

  for (const row of initialVersions) {
    if (!row || typeof row !== 'object') continue;
    const version = String(row.version || '').trim();
    const checksum = String(row.checksum || '').trim().toLowerCase();
    if (!version || !checksum) continue;
    schemaVersions.set(version, {
      checksum,
      appliedAt: row.appliedAt || '2026-01-01T00:00:00.000Z',
    });
  }

  return {
    appliedMigrationStatements,
    async query(sql, params = []) {
      const statement = String(sql || '').trim().replace(/\s+/g, ' ').toLowerCase();

      if (statement.startsWith('create table if not exists ie_schema_versions')) {
        return { rows: [], rowCount: 0 };
      }

      if (statement.startsWith('select version, checksum, applied_at from ie_schema_versions')) {
        const rows = [...schemaVersions.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([version, value]) => ({
            version,
            checksum: value.checksum,
            applied_at: value.appliedAt,
          }));
        return { rows, rowCount: rows.length };
      }

      if (statement === 'begin' || statement === 'commit' || statement === 'rollback') {
        return { rows: [], rowCount: 0 };
      }

      if (statement.startsWith('insert into ie_schema_versions')) {
        const version = String(params[0] || '').trim();
        const checksum = String(params[1] || '').trim().toLowerCase();
        schemaVersions.set(version, {
          checksum,
          appliedAt: new Date().toISOString(),
        });
        return { rows: [], rowCount: 1 };
      }

      if (
        statement.startsWith('create table if not exists ie_planning_records')
        || statement.startsWith('create table if not exists ie_planning_backfill_runs')
        || statement.startsWith('create table if not exists ie_planning_backfill_items_ledger')
      ) {
        appliedMigrationStatements.push(sql);
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected query in mock client: ${sql}`);
    },
  };
}

function createPlanningRecordClient(initialRows = [], options = {}) {
  const recordsById = new Map();
  const crashMode = options && typeof options.crashMode === 'string'
    ? options.crashMode.trim().toLowerCase()
    : null;
  let crashRemaining = Number.isFinite(options && options.crashCount)
    ? Math.max(0, Math.floor(options.crashCount))
    : 0;

  for (const row of initialRows) {
    if (!row || typeof row !== 'object') continue;
    const recordId = String(row.record_id || '').trim();
    if (!recordId) continue;
    recordsById.set(recordId, {
      record_id: recordId,
      owner_id: String(row.owner_id || '').trim().toLowerCase(),
      repo_id: row.repo_id == null ? null : String(row.repo_id).trim().toLowerCase(),
      scope: String(row.scope || '').trim().toLowerCase(),
      state: row.state && typeof row.state === 'object' ? row.state : {},
      created_at: row.created_at || '2026-01-01T00:00:00.000Z',
      updated_at: row.updated_at || '2026-01-01T00:00:00.000Z',
    });
  }

  return {
    recordsById,
    async query(sql, params = []) {
      const statement = String(sql || '').trim().replace(/\s+/g, ' ').toLowerCase();

      if (statement.startsWith('insert into ie_planning_records')) {
        if (crashMode === 'before_write' && crashRemaining > 0) {
          crashRemaining -= 1;
          throw new Error('simulated_write_through_crash_before_write');
        }

        const record = {
          record_id: String(params[0] || '').trim(),
          owner_id: String(params[1] || '').trim().toLowerCase(),
          repo_id: params[2] == null ? null : String(params[2]).trim().toLowerCase(),
          scope: String(params[3] || '').trim().toLowerCase(),
          state: typeof params[4] === 'string' ? JSON.parse(params[4]) : {},
          created_at: String(params[5] || '').trim(),
          updated_at: String(params[6] || '').trim(),
        };

        recordsById.set(record.record_id, record);

        if (crashMode === 'after_write' && crashRemaining > 0) {
          crashRemaining -= 1;
          throw new Error('simulated_write_through_crash_after_write');
        }

        return { rows: [{ ...record }], rowCount: 1 };
      }

      if (statement.startsWith('select record_id, owner_id, repo_id, scope, state, created_at, updated_at from ie_planning_records')) {
        const ownerId = String(params[0] || '').trim().toLowerCase();
        const rows = [...recordsById.values()]
          .filter((row) => row.owner_id === ownerId)
          .sort((a, b) => {
            const updatedDiff = Date.parse(b.updated_at) - Date.parse(a.updated_at);
            if (updatedDiff !== 0) return updatedDiff;
            const createdDiff = Date.parse(b.created_at) - Date.parse(a.created_at);
            if (createdDiff !== 0) return createdDiff;
            return String(a.record_id).localeCompare(String(b.record_id));
          })
          .map((row) => ({ ...row }));
        return { rows, rowCount: rows.length };
      }

      throw new Error(`Unexpected query in planning record client: ${sql}`);
    },
  };
}

function snapshotPlanningRecordRows(client) {
  if (!client || !(client.recordsById instanceof Map)) {
    return [];
  }

  return [...client.recordsById.values()].map((row) => ({
    ...row,
    state: row && typeof row.state === 'object' && row.state !== null
      ? JSON.parse(JSON.stringify(row.state))
      : row.state,
  }));
}

async function run() {
  await test('optional config defaults to not configured and does not fail validation', async () => {
    const config = readPlanningPersistenceConfig({});
    const validation = validatePlanningPersistenceConfig(config);

    assert.strictEqual(config.required, false);
    assert.strictEqual(config.databaseUrl, null);
    assert.strictEqual(validation.ok, true);
    assert.strictEqual(validation.status, 'not_configured');
    assert.strictEqual(validation.configured, false);
    assert.strictEqual(validation.usable, false);
    assert.deepStrictEqual(validation.errors, []);
  });

  await test('required mode fails validation when URL is missing or invalid', async () => {
    const missingConfig = readPlanningPersistenceConfig({
      INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '1',
    });
    const missingValidation = validatePlanningPersistenceConfig(missingConfig);
    assert.strictEqual(missingValidation.ok, false);
    assert.ok(missingValidation.errors.includes('database_url_required'));

    const invalidConfig = readPlanningPersistenceConfig({
      INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '1',
      INSTRUCTION_ENGINE_PLANNING_DB_URL: 'http://localhost/planning',
    });
    const invalidValidation = validatePlanningPersistenceConfig(invalidConfig);
    assert.strictEqual(invalidValidation.ok, false);
    assert.ok(invalidValidation.errors.includes('invalid_database_url_protocol'));
  });

  await test('migration runner applies once and reruns idempotently', async () => {
    const client = createMockClient();

    const firstRun = await runPlanningMigrations(client);
    assert.strictEqual(firstRun.appliedCount, PLANNING_MIGRATION_MANIFEST.length);
    assert.deepStrictEqual(firstRun.appliedVersions, PLANNING_MIGRATION_MANIFEST.map((migration) => migration.version));
    assert.strictEqual(firstRun.checksumValidation.outcome, 'pass');
    assert.strictEqual(firstRun.checksumValidation.reason, 'all_manifest_checksums_match');
    assert.strictEqual(firstRun.checksumValidation.driftDetected, false);
    assert.strictEqual(firstRun.checksumValidation.checkedVersionCount, PLANNING_MIGRATION_MANIFEST.length);
    assert.deepStrictEqual(firstRun.checksumValidation.checkedVersions, PLANNING_MIGRATION_MANIFEST.map((migration) => migration.version));
    assert.strictEqual(firstRun.checksumValidation.failure, null);

    const secondRun = await runPlanningMigrations(client);
    assert.strictEqual(secondRun.appliedCount, 0);
    assert.deepStrictEqual(secondRun.appliedVersions, []);
    assert.strictEqual(secondRun.checksumValidation.outcome, 'pass');
    assert.strictEqual(secondRun.checksumValidation.reason, 'all_manifest_checksums_match');
    assert.strictEqual(secondRun.checksumValidation.driftDetected, false);
    assert.strictEqual(secondRun.checksumValidation.checkedVersionCount, PLANNING_MIGRATION_MANIFEST.length);
    assert.deepStrictEqual(secondRun.checksumValidation.checkedVersions, PLANNING_MIGRATION_MANIFEST.map((migration) => migration.version));
    assert.strictEqual(secondRun.checksumValidation.failure, null);
    assert.strictEqual(client.appliedMigrationStatements.length, PLANNING_MIGRATION_MANIFEST.length);
  });

  await test('migration runner hard-fails on checksum drift', async () => {
    const [firstMigration] = PLANNING_MIGRATION_MANIFEST;
    const client = createMockClient({
      initialVersions: [{ version: firstMigration.version, checksum: 'deadbeef' }],
    });

    await assert.rejects(
      () => runPlanningMigrations(client),
      (error) => {
        assert.strictEqual(error.code, 'PLANNING_MIGRATION_CHECKSUM_DRIFT');
        assert.strictEqual(error.version, firstMigration.version);
        assert.ok(error.checksumValidation);
        assert.strictEqual(error.checksumValidation.outcome, 'fail');
        assert.strictEqual(error.checksumValidation.reason, 'manifest_checksum_drift_detected');
        assert.strictEqual(error.checksumValidation.driftDetected, true);
        assert.ok(error.checksumValidation.failure);
        assert.strictEqual(error.checksumValidation.failure.version, firstMigration.version);
        assert.strictEqual(error.checksumValidation.failure.expectedChecksum, firstMigration.checksum);
        assert.strictEqual(error.checksumValidation.failure.actualChecksum, 'deadbeef');
        return true;
      },
    );
  });

  await test('deriveBackfillSourceIdempotencyKey is deterministic for stable source identity inputs', async () => {
    const first = deriveBackfillSourceIdempotencyKey({
      scope: 'repo',
      sourceIdentity: 'Source-A',
      artifactPath: 'docs\\plan.md',
      artifactHash: 'ABC123',
      recordType: 'plan_record',
    });

    const second = deriveBackfillSourceIdempotencyKey({
      scope: 'repo',
      sourceIdentity: 'source-a',
      artifactPath: 'docs/plan.md',
      artifactHash: 'abc123',
      recordType: 'PLAN_RECORD',
    });

    const changed = deriveBackfillSourceIdempotencyKey({
      scope: 'repo',
      sourceIdentity: 'source-a',
      artifactPath: 'docs/plan.md',
      artifactHash: 'abc999',
      recordType: 'plan_record',
    });

    assert.strictEqual(first, second);
    assert.notStrictEqual(first, changed);
    assert.ok(first.startsWith('backfill:'));
  });

  await test('reconcileBackfillItemStatusTransition is idempotent and replay-safe', async () => {
    const firstTransition = reconcileBackfillItemStatusTransition({
      currentStatus: 'pending',
      nextStatus: 'processing',
    });
    assert.strictEqual(firstTransition.ok, true);
    assert.strictEqual(firstTransition.changed, true);
    assert.strictEqual(firstTransition.replay, false);

    const replay = reconcileBackfillItemStatusTransition({
      currentStatus: 'processing',
      nextStatus: 'processing',
    });
    assert.strictEqual(replay.ok, true);
    assert.strictEqual(replay.changed, false);
    assert.strictEqual(replay.replay, true);
    assert.strictEqual(replay.outcome, 'replay_noop');

    const invalid = reconcileBackfillItemStatusTransition({
      currentStatus: 'succeeded',
      nextStatus: 'processing',
    });
    assert.strictEqual(invalid.ok, false);
    assert.strictEqual(invalid.error.code, 'invalid_backfill_transition');
  });

  await test('scope predicate and visibility validation default deny invalid scope context', async () => {
    const deniedPredicate = buildPlanningScopeIsolationPredicate({
      scope: 'repo',
      ownerId: 'owner-1',
    });
    assert.strictEqual(deniedPredicate.ok, false);
    assert.strictEqual(deniedPredicate.deny, true);
    assert.strictEqual(deniedPredicate.where, '1=0');

    const deniedVisibility = validatePlanningReadWriteContext({
      action: 'write',
      scope: 'repo',
      ownerId: 'owner-1',
      actorId: 'owner-1',
    });
    assert.strictEqual(deniedVisibility.ok, false);
    assert.strictEqual(deniedVisibility.allowed, false);
    assert.strictEqual(deniedVisibility.error.code, 'scope_visibility_denied');
  });

  await test('optimistic concurrency guard returns deterministic conflict shape', async () => {
    const result = evaluatePlanningOptimisticConcurrencyGuard({
      resourceType: 'backfill_item',
      resourceId: 'item-42',
      expectedVersion: 7,
      expectedEtag: 'etag-v7',
      actualVersion: 8,
      actualEtag: 'etag-v8',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.conflict, true);
    assert.strictEqual(result.code, 'optimistic_concurrency_conflict');
    assert.strictEqual(result.result.kind, 'conflict');
    assert.strictEqual(result.result.conflictType, 'version_etag_mismatch');
    assert.strictEqual(result.result.resourceType, 'backfill_item');
    assert.strictEqual(result.result.resourceId, 'item-42');
    assert.strictEqual(result.result.checks.version.enforced, true);
    assert.strictEqual(result.result.checks.version.match, false);
    assert.strictEqual(result.result.checks.etag.enforced, true);
    assert.strictEqual(result.result.checks.etag.match, false);
  });

  await test('health contract always includes planning persistence fields', async () => {
    const config = readPlanningPersistenceConfig({});
    const health = getPlanningPersistenceHealth(config, {});

    assert.strictEqual(typeof health.contractVersion, 'string');
    assert.strictEqual(typeof health.required, 'boolean');
    assert.strictEqual(typeof health.configured, 'boolean');
    assert.strictEqual(typeof health.usable, 'boolean');
    assert.strictEqual(typeof health.status, 'string');
    assert.ok(health.migrations);
    assert.strictEqual(typeof health.migrations.schemaTable, 'string');
  });

  await test('health contract normalizes status and array fields deterministically', async () => {
    const config = readPlanningPersistenceConfig({
      INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '1',
      INSTRUCTION_ENGINE_PLANNING_DB_URL: 'postgres://localhost:5432/planning',
    });

    const health = getPlanningPersistenceHealth(config, {
      status: 'unknown_status',
      validation: {
        required: true,
        configured: true,
        usable: true,
        errors: ['beta', 'Alpha', 'beta', '', null],
      },
      migrations: {
        schemaTable: ' custom_schema_versions ',
        appliedCount: '3.9',
        appliedVersions: ['003', '001', '002', '001'],
        driftDetected: 1,
        lastRunAt: '2026-02-26T01:23:45.000Z',
      },
      lastError: '  transient_failure  ',
    });

    assert.strictEqual(health.status, 'ready');
    assert.deepStrictEqual(health.errors, ['Alpha', 'beta']);
    assert.strictEqual(health.lastError, 'transient_failure');
    assert.strictEqual(health.migrations.schemaTable, 'custom_schema_versions');
    assert.strictEqual(health.migrations.appliedCount, 3);
    assert.deepStrictEqual(health.migrations.appliedVersions, ['001', '002', '003']);
    assert.strictEqual(health.migrations.lastRunAt, '2026-02-26T01:23:45.000Z');
  });

  await test('provider state defaults to non-docker when no explicit valid selection exists', async () => {
    const providerState = readPlanningProviderState({ env: {} });

    assert.strictEqual(providerState.contractVersion, PLANNING_PROVIDER_STATE_CONTRACT_VERSION);
    assert.strictEqual(providerState.selectedProvider, 'non-docker');
    assert.strictEqual(providerState.defaultProvider, 'non-docker');
    assert.strictEqual(providerState.selectionSource, 'default');
    assert.strictEqual(providerState.migration.required, true);
    assert.ok(providerState.migration.reasonCodes.includes('provider_state_absent'));
    assert.ok(providerState.migration.reasonCodes.includes('default_provider_applied'));
  });

  await test('provider state safely migrates legacy persisted provider fields', async () => {
    const providerState = readPlanningProviderState({
      persistedState: {
        runtimeProvider: 'docker',
        runtimeProviderDefault: 'non-docker',
      },
      env: {
        INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED: 'non-docker',
      },
    });

    assert.strictEqual(providerState.selectedProvider, 'docker');
    assert.strictEqual(providerState.defaultProvider, 'non-docker');
    assert.strictEqual(providerState.selectionSource, 'explicit');
    assert.strictEqual(providerState.migration.required, true);
    assert.ok(providerState.migration.reasonCodes.includes('legacy_selected_provider_migrated'));
    assert.ok(providerState.migration.reasonCodes.includes('legacy_default_provider_migrated'));
    assert.ok(providerState.migration.reasonCodes.includes('provider_state_contract_mismatch'));
  });

  await test('provider state does not require migration when canonical persisted state is present', async () => {
    const providerState = readPlanningProviderState({
      persistedState: {
        contractVersion: PLANNING_PROVIDER_STATE_CONTRACT_VERSION,
        selectedProvider: 'docker',
        defaultProvider: 'non-docker',
        selectionSource: 'explicit',
      },
      env: {
        INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED: 'non-docker',
        INSTRUCTION_ENGINE_RUNTIME_PROVIDER_DEFAULT: 'docker',
      },
    });

    assert.strictEqual(providerState.selectedProvider, 'docker');
    assert.strictEqual(providerState.defaultProvider, 'non-docker');
    assert.strictEqual(providerState.selectionSource, 'explicit');
    assert.strictEqual(providerState.migration.required, false);
    assert.deepStrictEqual(providerState.migration.reasonCodes, []);
  });

  await test('provider state uses canonical persisted SSOT deterministically across env drift', async () => {
    const persistedState = {
      contractVersion: PLANNING_PROVIDER_STATE_CONTRACT_VERSION,
      selectedProvider: 'docker',
      defaultProvider: 'non-docker',
      selectionSource: 'explicit',
    };

    const fromFirstEnv = readPlanningProviderState({
      persistedState,
      env: {
        INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED: 'non-docker',
        INSTRUCTION_ENGINE_RUNTIME_PROVIDER_DEFAULT: 'docker',
      },
    });

    const fromSecondEnv = readPlanningProviderState({
      persistedState,
      env: {
        INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED: 'docker',
        INSTRUCTION_ENGINE_RUNTIME_PROVIDER_DEFAULT: 'non-docker',
      },
    });

    assert.deepStrictEqual(fromFirstEnv, fromSecondEnv);
    assert.strictEqual(fromFirstEnv.selectedProvider, 'docker');
    assert.strictEqual(fromFirstEnv.defaultProvider, 'non-docker');
    assert.strictEqual(fromFirstEnv.selectionSource, 'explicit');
    assert.strictEqual(fromFirstEnv.migration.required, false);
    assert.deepStrictEqual(fromFirstEnv.migration.reasonCodes, []);
  });

  await test('provider state preserves canonical persisted default selection source without migration', async () => {
    const providerState = readPlanningProviderState({
      persistedState: {
        contractVersion: PLANNING_PROVIDER_STATE_CONTRACT_VERSION,
        selectedProvider: 'non-docker',
        defaultProvider: 'non-docker',
        selectionSource: 'default',
      },
      env: {
        INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED: 'docker',
      },
    });

    assert.strictEqual(providerState.selectedProvider, 'non-docker');
    assert.strictEqual(providerState.defaultProvider, 'non-docker');
    assert.strictEqual(providerState.selectionSource, 'default');
    assert.strictEqual(providerState.migration.required, false);
    assert.deepStrictEqual(providerState.migration.reasonCodes, []);
  });

  await test('provider state persistence payload canonicalizes invalid values deterministically', async () => {
    const payload = buildPlanningProviderStatePersistencePayload({
      selectedProvider: 'invalid-provider',
      defaultProvider: 'also-invalid',
    });

    assert.strictEqual(payload.contractVersion, PLANNING_PROVIDER_STATE_CONTRACT_VERSION);
    assert.strictEqual(payload.selectedProvider, 'non-docker');
    assert.strictEqual(payload.defaultProvider, 'non-docker');
    assert.strictEqual(payload.selectionSource, 'default');
  });

  await test('planning record normalization and next record derivation are deterministic', async () => {
    const normalized = normalizePlanningRecordForPersistence({
      recordId: ' planning-000042 ',
      scope: 'Repo',
      ownerId: 'OWNER-1',
      repoId: 'Repo-1',
      title: '  Durable title  ',
      summary: '  Durable summary  ',
      state: 'Queued',
      score: '0.75',
      createdAt: '2026-02-26T00:00:00.000Z',
      updatedAt: '2026-02-26T00:01:00.000Z',
    });

    assert.strictEqual(normalized.recordId, 'planning-000042');
    assert.strictEqual(normalized.scope, 'repo');
    assert.strictEqual(normalized.ownerId, 'owner-1');
    assert.strictEqual(normalized.repoId, 'repo-1');
    assert.strictEqual(normalized.title, 'Durable title');
    assert.strictEqual(normalized.summary, 'Durable summary');
    assert.strictEqual(normalized.state, 'queued');
    assert.strictEqual(normalized.score, 0.75);
    assert.strictEqual(deriveNextPlanningRecordNumber([
      { recordId: 'planning-000041' },
      { recordId: 'planning-000042' },
      { recordId: 'custom-id' },
    ]), 43);
  });

  await test('persist/list planning records use DB authority and enforce write visibility', async () => {
    const client = createPlanningRecordClient();

    const repoWrite = await persistPlanningRecord(client, {
      actorId: 'user-1',
      record: {
        recordId: 'planning-000002',
        scope: 'repo',
        ownerId: 'user-1',
        repoId: 'repo-1',
        title: 'Repo record',
        summary: 'Persist me',
        state: 'queued',
        score: 0.9,
        createdAt: '2026-02-26T00:00:00.000Z',
        updatedAt: '2026-02-26T00:00:00.000Z',
      },
    });
    assert.strictEqual(repoWrite.ok, true);
    assert.strictEqual(repoWrite.record.recordId, 'planning-000002');

    const userWrite = await persistPlanningRecord(client, {
      actorId: 'user-1',
      record: {
        recordId: 'planning-000001',
        scope: 'user',
        ownerId: 'user-1',
        repoId: null,
        title: 'User record',
        summary: 'Persist me too',
        state: 'research',
        score: 0.5,
        createdAt: '2026-02-26T00:00:00.000Z',
        updatedAt: '2026-02-26T00:01:00.000Z',
      },
    });
    assert.strictEqual(userWrite.ok, true);
    assert.strictEqual(userWrite.record.recordId, 'planning-000001');

    const deniedWrite = await persistPlanningRecord(client, {
      actorId: 'user-2',
      record: {
        recordId: 'planning-000003',
        scope: 'user',
        ownerId: 'user-1',
        title: 'Denied',
        summary: 'Denied write',
      },
    });
    assert.strictEqual(deniedWrite.ok, false);
    assert.strictEqual(deniedWrite.error.code, 'scope_visibility_denied');

    const listed = await listPersistedPlanningRecords(client, {
      actorId: 'user-1',
      repoId: 'repo-1',
      scopes: ['repo', 'user'],
    });

    assert.strictEqual(listed.ok, true);
    assert.deepStrictEqual(listed.records.map((record) => record.recordId), ['planning-000001', 'planning-000002']);
    assert.strictEqual(listed.nextRecordNumber, 3);
  });

  await test('write-through crash before DB mutation fails without silent partial write assumptions', async () => {
    const client = createPlanningRecordClient([], {
      crashMode: 'before_write',
      crashCount: 1,
    });

    await assert.rejects(
      () => persistPlanningRecord(client, {
        actorId: 'user-1',
        record: {
          recordId: 'planning-000210',
          scope: 'repo',
          ownerId: 'user-1',
          repoId: 'repo-1',
          title: 'Crash before write',
          summary: 'should not persist',
          state: 'queued',
          score: 0.4,
          createdAt: '2026-02-26T05:00:00.000Z',
          updatedAt: '2026-02-26T05:00:00.000Z',
        },
      }),
      /simulated_write_through_crash_before_write/,
    );

    const postCrashList = await listPersistedPlanningRecords(client, {
      actorId: 'user-1',
      repoId: 'repo-1',
      scopes: ['repo'],
    });

    assert.strictEqual(postCrashList.ok, true);
    assert.deepStrictEqual(postCrashList.records, []);
    assert.strictEqual(postCrashList.nextRecordNumber, 1);
  });

  await test('write-through crash after DB mutation is restart-recoverable via persisted authority read-back', async () => {
    const crashingClient = createPlanningRecordClient([], {
      crashMode: 'after_write',
      crashCount: 1,
    });

    const durableRecord = {
      recordId: 'planning-000211',
      scope: 'repo',
      ownerId: 'user-1',
      repoId: 'repo-1',
      title: 'Durable after write-through',
      summary: 'persisted before simulated crash',
      state: 'research',
      score: 0.8,
      createdAt: '2026-02-26T05:10:00.000Z',
      updatedAt: '2026-02-26T05:10:00.000Z',
    };

    await assert.rejects(
      () => persistPlanningRecord(crashingClient, {
        actorId: 'user-1',
        record: durableRecord,
      }),
      /simulated_write_through_crash_after_write/,
    );

    const recoveredBeforeRestart = await listPersistedPlanningRecords(crashingClient, {
      actorId: 'user-1',
      repoId: 'repo-1',
      scopes: ['repo'],
    });

    assert.strictEqual(recoveredBeforeRestart.ok, true);
    assert.deepStrictEqual(
      recoveredBeforeRestart.records.map((record) => record.recordId),
      ['planning-000211'],
    );
    assert.strictEqual(recoveredBeforeRestart.nextRecordNumber, 212);

    const restartedClient = createPlanningRecordClient(snapshotPlanningRecordRows(crashingClient));
    const recoveredAfterRestart = await listPersistedPlanningRecords(restartedClient, {
      actorId: 'user-1',
      repoId: 'repo-1',
      scopes: ['repo'],
    });

    assert.strictEqual(recoveredAfterRestart.ok, true);
    assert.deepStrictEqual(
      recoveredAfterRestart.records.map((record) => record.recordId),
      ['planning-000211'],
    );
    assert.strictEqual(recoveredAfterRestart.nextRecordNumber, 212);

    const retryWrite = await persistPlanningRecord(restartedClient, {
      actorId: 'user-1',
      record: durableRecord,
    });
    assert.strictEqual(retryWrite.ok, true);

    const postRetry = await listPersistedPlanningRecords(restartedClient, {
      actorId: 'user-1',
      repoId: 'repo-1',
      scopes: ['repo'],
    });
    assert.strictEqual(postRetry.ok, true);
    assert.deepStrictEqual(postRetry.records.map((record) => record.recordId), ['planning-000211']);
    assert.strictEqual(postRetry.nextRecordNumber, 212);
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

run().catch((e) => {
  console.error(e.stack || e.message || String(e));
  process.exit(1);
});
