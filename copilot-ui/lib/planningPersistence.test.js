'use strict';

const assert = require('assert');
const {
  PLANNING_MIGRATION_MANIFEST,
  buildPlanningScopeIsolationPredicate,
  deriveBackfillSourceIdempotencyKey,
  evaluatePlanningOptimisticConcurrencyGuard,
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

    const secondRun = await runPlanningMigrations(client);
    assert.strictEqual(secondRun.appliedCount, 0);
    assert.deepStrictEqual(secondRun.appliedVersions, []);
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
