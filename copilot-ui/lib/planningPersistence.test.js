'use strict';

const assert = require('assert');
const {
  PLANNING_PROVIDER_STATE_CONTRACT_VERSION,
  PLANNING_WS5A_DURABILITY_REQUIRED_MIGRATION_VERSIONS,
  PLANNING_MIGRATION_MANIFEST,
  PLANNING_MIGRATION_CHECKSUM_BASELINE,
  buildPlanningProviderStatePersistencePayload,
  buildPlanningScopeIsolationPredicate,
  computeManifestChecksumBaseline,
  deriveNextPlanningRecordNumber,
  deriveBackfillSourceIdempotencyKey,
  evaluatePlanningOptimisticConcurrencyGuard,
  listPersistedPlanningRecords,
  normalizePlanningRecordForPersistence,
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
        || statement.startsWith('create table if not exists ie_planning_compare_receipts')
        || statement.startsWith('create table if not exists ie_planning_merge_intents')
        || statement.startsWith('create table if not exists ie_planning_merge_idempotency_ledger')
        || statement.startsWith('create table if not exists ie_planning_suggestions')
        || statement.startsWith('create table if not exists ie_planning_recaps')
        || statement.startsWith('create table if not exists ie_planning_workflow_artifacts')
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

      if (statement.startsWith('select record_id, owner_id, repo_id, scope, state, created_at, updated_at from ie_planning_records where record_id = $1')) {
        const recordId = String(params[0] || '').trim();
        const row = recordId ? recordsById.get(recordId) : null;
        return {
          rows: row ? [{ ...row }] : [],
          rowCount: row ? 1 : 0,
        };
      }

      if (statement.startsWith('select record_id from ie_planning_records where updated_at < $1::timestamptz')) {
        const cutoff = Date.parse(String(params[0] || '').trim());
        const rows = [...recordsById.values()]
          .filter((row) => Number.isFinite(cutoff) && Date.parse(row.updated_at) < cutoff)
          .sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)))
          .map((row) => ({ record_id: row.record_id }));
        return { rows, rowCount: rows.length };
      }

      if (statement.startsWith('delete from ie_planning_records where record_id = any($1::text[]) returning record_id')) {
        const ids = Array.isArray(params[0]) ? params[0].map((id) => String(id || '').trim()) : [];
        const deleted = [];
        for (const id of ids) {
          if (!id) continue;
          if (recordsById.delete(id)) {
            deleted.push({ record_id: id });
          }
        }
        deleted.sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));
        return { rows: deleted, rowCount: deleted.length };
      }

      if (statement.startsWith('select record_id, owner_id, repo_id, scope, state, created_at, updated_at from ie_planning_records order by owner_id asc, scope asc, repo_id asc nulls first, record_id asc')) {
        const rows = [...recordsById.values()]
          .sort((a, b) => {
            const ownerDiff = String(a.owner_id || '').localeCompare(String(b.owner_id || ''));
            if (ownerDiff !== 0) return ownerDiff;
            const scopeDiff = String(a.scope || '').localeCompare(String(b.scope || ''));
            if (scopeDiff !== 0) return scopeDiff;
            const repoDiff = String(a.repo_id || '').localeCompare(String(b.repo_id || ''));
            if (repoDiff !== 0) return repoDiff;
            return String(a.record_id || '').localeCompare(String(b.record_id || ''));
          })
          .map((row) => ({ ...row }));
        return { rows, rowCount: rows.length };
      }

      if (statement.startsWith('select record_id, owner_id, repo_id, scope, state, created_at, updated_at from ie_planning_records where owner_id = $1')) {
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

function createDurabilityArtifactClient(options = {}) {
  const compareReceipts = new Map();
  const mergeIntents = new Map();
  const suggestions = new Map();
  const recaps = new Map();
  const workflowArtifacts = new Map();
  const idempotencyLedger = new Map();

  const recordClient = createPlanningRecordClient(
    Array.isArray(options.initialPlanningRows) ? options.initialPlanningRows : [],
  );

  return {
    compareReceipts,
    mergeIntents,
    suggestions,
    recaps,
    workflowArtifacts,
    idempotencyLedger,
    recordsById: recordClient.recordsById,
    async query(sql, params = []) {
      const statement = String(sql || '').trim().replace(/\s+/g, ' ').toLowerCase();

      if (statement.startsWith('insert into ie_planning_compare_receipts')) {
        const row = {
          receipt_id: String(params[0] || '').trim(),
          actor_id: String(params[1] || '').trim().toLowerCase(),
          repo_id: params[2] == null ? null : String(params[2]).trim().toLowerCase(),
          compare_hash: String(params[3] || '').trim(),
          source_ids_hash: String(params[4] || '').trim(),
          source_ids: typeof params[5] === 'string' ? JSON.parse(params[5]) : [],
          version_vector: typeof params[6] === 'string' ? JSON.parse(params[6]) : null,
          gate_state: String(params[7] || '').trim(),
          merge_eligible: params[8] === true,
          reason: String(params[9] || '').trim(),
          downgrade: typeof params[10] === 'string' ? JSON.parse(params[10]) : null,
          issued_at: String(params[11] || '').trim(),
          expires_at: String(params[12] || '').trim(),
        };
        compareReceipts.set(row.receipt_id, row);
        return { rows: [{ ...row }], rowCount: 1 };
      }

      if (statement.startsWith('select receipt_id, actor_id, repo_id, compare_hash, source_ids_hash, source_ids, version_vector, gate_state, merge_eligible, reason, downgrade, issued_at, expires_at from ie_planning_compare_receipts where receipt_id = $1')) {
        const receiptId = String(params[0] || '').trim();
        const row = receiptId ? compareReceipts.get(receiptId) : null;
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      if (statement.startsWith('delete from ie_planning_compare_receipts where receipt_id = $1')) {
        const receiptId = String(params[0] || '').trim();
        const deleted = compareReceipts.delete(receiptId);
        return { rows: [], rowCount: deleted ? 1 : 0 };
      }

      if (statement.startsWith('insert into ie_planning_merge_intents')) {
        const row = {
          token_id: String(params[0] || '').trim(),
          compare_receipt_id: String(params[1] || '').trim(),
          actor_id: String(params[2] || '').trim().toLowerCase(),
          repo_id: params[3] == null ? null : String(params[3]).trim().toLowerCase(),
          target_id: String(params[4] || '').trim(),
          source_ids_hash: String(params[5] || '').trim(),
          compare_hash: String(params[6] || '').trim(),
          version_vector: typeof params[7] === 'string' ? JSON.parse(params[7]) : null,
          version_vector_hash: params[8] == null ? null : String(params[8]).trim(),
          issued_at: String(params[9] || '').trim(),
          expires_at: String(params[10] || '').trim(),
          consumed_at: params[11] == null ? null : String(params[11]).trim(),
        };
        mergeIntents.set(row.token_id, row);
        return { rows: [{ ...row }], rowCount: 1 };
      }

      if (statement.startsWith('select token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash, compare_hash, version_vector, version_vector_hash, issued_at, expires_at, consumed_at from ie_planning_merge_intents where token_id = $1')) {
        const tokenId = String(params[0] || '').trim();
        const row = tokenId ? mergeIntents.get(tokenId) : null;
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      if (statement.startsWith('delete from ie_planning_merge_intents where token_id = $1')) {
        const tokenId = String(params[0] || '').trim();
        const deleted = mergeIntents.delete(tokenId);
        return { rows: [], rowCount: deleted ? 1 : 0 };
      }

      if (statement.startsWith('update ie_planning_merge_intents set consumed_at = $2::timestamptz where token_id = $1 and consumed_at is null returning token_id')) {
        const tokenId = String(params[0] || '').trim();
        const consumedAt = String(params[1] || '').trim();
        const existing = tokenId ? mergeIntents.get(tokenId) : null;
        if (!existing || existing.consumed_at) {
          return { rows: [], rowCount: 0 };
        }

        const updated = { ...existing, consumed_at: consumedAt };
        mergeIntents.set(tokenId, updated);
        return { rows: [{ ...updated }], rowCount: 1 };
      }

      if (statement.startsWith('update ie_planning_merge_intents set consumed_at = null where token_id = $1 returning token_id')) {
        const tokenId = String(params[0] || '').trim();
        const existing = tokenId ? mergeIntents.get(tokenId) : null;
        if (!existing) {
          return { rows: [], rowCount: 0 };
        }

        mergeIntents.set(tokenId, {
          ...existing,
          consumed_at: null,
        });
        return { rows: [{ token_id: tokenId }], rowCount: 1 };
      }

      if (statement.startsWith('insert into ie_planning_suggestions')) {
        const suggestionId = String(params[0] || '').trim();
        const actorId = String(params[1] || '').trim().toLowerCase();
        const repoId = params[2] == null ? null : String(params[2]).trim().toLowerCase();
        const scope = String(params[3] || '').trim().toLowerCase();
        const state = typeof params[4] === 'string' ? JSON.parse(params[4]) : {};
        const createdAt = String(params[5] || '').trim();
        const updatedAt = String(params[6] || '').trim();
        const existing = suggestionId ? suggestions.get(suggestionId) : null;

        if (existing) {
          if (existing.actor_id !== actorId) {
            return { rows: [], rowCount: 0 };
          }

          const updated = {
            ...existing,
            actor_id: actorId,
            repo_id: repoId,
            scope,
            state,
            updated_at: updatedAt,
          };
          suggestions.set(suggestionId, updated);
          return { rows: [{ ...updated }], rowCount: 1 };
        }

        const inserted = {
          suggestion_id: suggestionId,
          actor_id: actorId,
          repo_id: repoId,
          scope,
          state,
          created_at: createdAt,
          updated_at: updatedAt,
        };

        suggestions.set(suggestionId, inserted);
        return { rows: [{ ...inserted }], rowCount: 1 };
      }

      if (statement.startsWith('select suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at from ie_planning_suggestions where suggestion_id = $1')) {
        const suggestionId = String(params[0] || '').trim();
        const row = suggestionId ? suggestions.get(suggestionId) : null;
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      if (statement.startsWith('insert into ie_planning_recaps')) {
        const recapId = String(params[0] || '').trim();
        const actorId = String(params[1] || '').trim().toLowerCase();
        const repoId = params[2] == null ? null : String(params[2]).trim().toLowerCase();
        const scope = String(params[3] || '').trim().toLowerCase();
        const state = typeof params[4] === 'string' ? JSON.parse(params[4]) : {};
        const createdAt = String(params[5] || '').trim();
        const updatedAt = String(params[6] || '').trim();
        const existing = recapId ? recaps.get(recapId) : null;

        if (existing) {
          if (existing.actor_id !== actorId) {
            return { rows: [], rowCount: 0 };
          }

          const updated = {
            ...existing,
            actor_id: actorId,
            repo_id: repoId,
            scope,
            state,
            updated_at: updatedAt,
          };
          recaps.set(recapId, updated);
          return { rows: [{ ...updated }], rowCount: 1 };
        }

        const inserted = {
          recap_id: recapId,
          actor_id: actorId,
          repo_id: repoId,
          scope,
          state,
          created_at: createdAt,
          updated_at: updatedAt,
        };

        recaps.set(recapId, inserted);
        return { rows: [{ ...inserted }], rowCount: 1 };
      }

      if (statement.startsWith('select recap_id, actor_id, repo_id, scope, state, created_at, updated_at from ie_planning_recaps where recap_id = $1')) {
        const recapId = String(params[0] || '').trim();
        const row = recapId ? recaps.get(recapId) : null;
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      if (statement.startsWith('insert into ie_planning_workflow_artifacts')) {
        const artifactId = String(params[0] || '').trim();
        const actorId = String(params[1] || '').trim().toLowerCase();
        const repoId = params[2] == null ? null : String(params[2]).trim().toLowerCase();
        const existing = artifactId ? workflowArtifacts.get(artifactId) : null;

        if (existing) {
          if (existing.actor_id !== actorId) {
            return { rows: [], rowCount: 0 };
          }

          const updated = {
            ...existing,
            actor_id: actorId,
            repo_id: repoId,
            roadmap_id: String(params[3] || '').trim(),
            slice_id: params[4] == null ? null : String(params[4]).trim(),
            kind: String(params[5] || '').trim(),
            phase: String(params[6] || '').trim(),
            status: String(params[7] || '').trim(),
            checksum: String(params[8] || '').trim(),
            source_harness: params[9] == null ? null : String(params[9]).trim(),
            source_model: params[10] == null ? null : String(params[10]).trim(),
            session_id: params[11] == null ? null : String(params[11]).trim(),
            body: String(params[12] || ''),
            structured_state: typeof params[13] === 'string' ? JSON.parse(params[13]) : {},
            updated_at: String(params[15] || '').trim(),
          };
          workflowArtifacts.set(artifactId, updated);
          return { rows: [{ ...updated }], rowCount: 1 };
        }

        const inserted = {
          artifact_id: artifactId,
          actor_id: actorId,
          repo_id: repoId,
          roadmap_id: String(params[3] || '').trim(),
          slice_id: params[4] == null ? null : String(params[4]).trim(),
          kind: String(params[5] || '').trim(),
          phase: String(params[6] || '').trim(),
          status: String(params[7] || '').trim(),
          checksum: String(params[8] || '').trim(),
          source_harness: params[9] == null ? null : String(params[9]).trim(),
          source_model: params[10] == null ? null : String(params[10]).trim(),
          session_id: params[11] == null ? null : String(params[11]).trim(),
          body: String(params[12] || ''),
          structured_state: typeof params[13] === 'string' ? JSON.parse(params[13]) : {},
          created_at: String(params[14] || '').trim(),
          updated_at: String(params[15] || '').trim(),
        };
        workflowArtifacts.set(artifactId, inserted);
        return { rows: [{ ...inserted }], rowCount: 1 };
      }

      if (statement.startsWith('select artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status, checksum, source_harness, source_model, session_id, body, structured_state, created_at, updated_at from ie_planning_workflow_artifacts where artifact_id = $1')) {
        const artifactId = String(params[0] || '').trim();
        const row = artifactId ? workflowArtifacts.get(artifactId) : null;
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      if (statement.startsWith('select artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status, checksum, source_harness, source_model, session_id, body, structured_state, created_at, updated_at from ie_planning_workflow_artifacts where roadmap_id = $1 order by updated_at desc, artifact_id asc')) {
        const roadmapId = String(params[0] || '').trim();
        const rows = [...workflowArtifacts.values()]
          .filter((row) => row.roadmap_id === roadmapId)
          .sort((left, right) => {
            const updatedDiff = Date.parse(String(right.updated_at || '')) - Date.parse(String(left.updated_at || ''));
            if (updatedDiff !== 0) return updatedDiff;
            return String(left.artifact_id || '').localeCompare(String(right.artifact_id || ''));
          })
          .map((row) => ({ ...row }));
        return { rows, rowCount: rows.length };
      }

      if (statement.startsWith('select idempotency_key, actor_id, repo_id, operation_type, target_id, source_ids_hash, compare_hash, payload_hash, merge_record_id, response, created_at, expires_at from ie_planning_merge_idempotency_ledger where idempotency_key = $1')) {
        const idempotencyKey = String(params[0] || '').trim();
        const row = idempotencyKey ? idempotencyLedger.get(idempotencyKey) : null;
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      if (statement.startsWith('insert into ie_planning_merge_idempotency_ledger')) {
        const now = new Date().toISOString();
        const row = {
          idempotency_key: String(params[0] || '').trim(),
          actor_id: String(params[1] || '').trim().toLowerCase(),
          repo_id: params[2] == null ? null : String(params[2]).trim().toLowerCase(),
          operation_type: String(params[3] || '').trim(),
          target_id: String(params[4] || '').trim(),
          source_ids_hash: String(params[5] || '').trim(),
          compare_hash: String(params[6] || '').trim(),
          payload_hash: String(params[7] || '').trim(),
          merge_record_id: params[8] == null ? null : String(params[8]).trim(),
          response: typeof params[9] === 'string' ? JSON.parse(params[9]) : {},
          created_at: now,
          expires_at: String(params[10] || '').trim(),
        };
        idempotencyLedger.set(row.idempotency_key, row);
        return { rows: [{ ...row }], rowCount: 1 };
      }

      if (statement.startsWith('delete from ie_planning_merge_idempotency_ledger where idempotency_key = $1 returning idempotency_key')) {
        const idempotencyKey = String(params[0] || '').trim();
        const deleted = idempotencyLedger.delete(idempotencyKey);
        return {
          rows: deleted ? [{ idempotency_key: idempotencyKey }] : [],
          rowCount: deleted ? 1 : 0,
        };
      }

      if (statement.startsWith('delete from ie_planning_merge_idempotency_ledger where idempotency_key = $1')) {
        const idempotencyKey = String(params[0] || '').trim();
        const deleted = idempotencyLedger.delete(idempotencyKey);
        return { rows: [], rowCount: deleted ? 1 : 0 };
      }

      if (statement.startsWith('delete from ie_planning_records where record_id = $1 returning record_id')) {
        const recordId = String(params[0] || '').trim();
        const deleted = recordClient.recordsById.delete(recordId);
        return {
          rows: deleted ? [{ record_id: recordId }] : [],
          rowCount: deleted ? 1 : 0,
        };
      }

      return recordClient.query(sql, params);
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
    assert.strictEqual(firstRun.checksumBaseline, PLANNING_MIGRATION_CHECKSUM_BASELINE);
    assert.strictEqual(firstRun.baselineEnforced, true);
    assert.strictEqual(firstRun.baselineMismatch, false);
    assert.strictEqual(firstRun.checksumValidation.outcome, 'pass');
    assert.strictEqual(firstRun.checksumValidation.reason, 'all_manifest_checksums_match');
    assert.strictEqual(firstRun.checksumValidation.driftDetected, false);
    assert.strictEqual(firstRun.checksumValidation.baselineMismatch, false);
    assert.strictEqual(firstRun.checksumValidation.checkedVersionCount, PLANNING_MIGRATION_MANIFEST.length);
    assert.deepStrictEqual(firstRun.checksumValidation.checkedVersions, PLANNING_MIGRATION_MANIFEST.map((migration) => migration.version));
    assert.strictEqual(firstRun.checksumValidation.manifestVersionCount, PLANNING_MIGRATION_MANIFEST.length);
    assert.strictEqual(firstRun.checksumValidation.manifestChecksumBaseline, PLANNING_MIGRATION_CHECKSUM_BASELINE);
    assert.strictEqual(firstRun.checksumValidation.enforcement, 'fail_closed');
    assert.strictEqual(firstRun.checksumValidation.failure, null);

    const secondRun = await runPlanningMigrations(client);
    assert.strictEqual(secondRun.appliedCount, 0);
    assert.deepStrictEqual(secondRun.appliedVersions, []);
    assert.strictEqual(secondRun.checksumBaseline, PLANNING_MIGRATION_CHECKSUM_BASELINE);
    assert.strictEqual(secondRun.baselineEnforced, true);
    assert.strictEqual(secondRun.baselineMismatch, false);
    assert.strictEqual(secondRun.checksumValidation.outcome, 'pass');
    assert.strictEqual(secondRun.checksumValidation.reason, 'all_manifest_checksums_match');
    assert.strictEqual(secondRun.checksumValidation.driftDetected, false);
    assert.strictEqual(secondRun.checksumValidation.baselineMismatch, false);
    assert.strictEqual(secondRun.checksumValidation.checkedVersionCount, PLANNING_MIGRATION_MANIFEST.length);
    assert.deepStrictEqual(secondRun.checksumValidation.checkedVersions, PLANNING_MIGRATION_MANIFEST.map((migration) => migration.version));
    assert.strictEqual(secondRun.checksumValidation.manifestVersionCount, PLANNING_MIGRATION_MANIFEST.length);
    assert.strictEqual(secondRun.checksumValidation.manifestChecksumBaseline, PLANNING_MIGRATION_CHECKSUM_BASELINE);
    assert.strictEqual(secondRun.checksumValidation.enforcement, 'fail_closed');
    assert.strictEqual(secondRun.checksumValidation.failure, null);
    assert.strictEqual(client.appliedMigrationStatements.length, PLANNING_MIGRATION_MANIFEST.length);
  });

  await test('manifest checksum baseline derivation is deterministic', async () => {
    const first = computeManifestChecksumBaseline(PLANNING_MIGRATION_MANIFEST);
    const second = computeManifestChecksumBaseline(PLANNING_MIGRATION_MANIFEST.slice().reverse());

    assert.strictEqual(first, second);
    assert.strictEqual(first, PLANNING_MIGRATION_CHECKSUM_BASELINE);
  });

  await test('WS5A M1 required durability migration versions are present in manifest', async () => {
    const manifestVersions = new Set(
      PLANNING_MIGRATION_MANIFEST.map((migration) => String(migration.version || '').trim()),
    );

    for (const requiredVersion of PLANNING_WS5A_DURABILITY_REQUIRED_MIGRATION_VERSIONS) {
      assert.ok(
        manifestVersions.has(requiredVersion),
        `Missing required WS5A durability migration version: ${requiredVersion}`,
      );
    }
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

  await test('migration runner hard-fails on checksum baseline mismatch when unexpected versions exist', async () => {
    const client = createMockClient({
      initialVersions: [
        {
          version: '999_unexpected_manual_migration',
          checksum: 'abcdef0123456789',
        },
      ],
    });

    await assert.rejects(
      () => runPlanningMigrations(client),
      (error) => {
        assert.strictEqual(error.code, 'PLANNING_MIGRATION_BASELINE_MISMATCH');
        assert.ok(Array.isArray(error.unexpectedVersions));
        assert.deepStrictEqual(error.unexpectedVersions, ['999_unexpected_manual_migration']);
        assert.ok(error.checksumValidation);
        assert.strictEqual(error.checksumValidation.outcome, 'fail');
        assert.strictEqual(error.checksumValidation.reason, 'manifest_checksum_baseline_mismatch');
        assert.strictEqual(error.checksumValidation.baselineMismatch, true);
        assert.ok(error.checksumValidation.failure);
        assert.deepStrictEqual(
          error.checksumValidation.failure.unexpectedVersions,
          ['999_unexpected_manual_migration'],
        );
        return true;
      },
    );
  });

  await test('migration runner enforces expected checksum baseline option fail-closed', async () => {
    const client = createMockClient();

    await assert.rejects(
      () => runPlanningMigrations(client, {
        expectedChecksumBaseline: 'deadbeef',
      }),
      (error) => {
        assert.strictEqual(error.code, 'PLANNING_MIGRATION_BASELINE_MISMATCH');
        assert.strictEqual(error.expectedChecksumBaseline, 'deadbeef');
        assert.strictEqual(error.actualChecksumBaseline, computeManifestChecksumBaseline(PLANNING_MIGRATION_MANIFEST));
        assert.ok(error.checksumValidation);
        assert.strictEqual(error.checksumValidation.outcome, 'fail');
        assert.strictEqual(error.checksumValidation.reason, 'manifest_checksum_baseline_mismatch');
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
    assert.strictEqual(result.deterministic, true);
    assert.strictEqual(result.code, 'optimistic_concurrency_conflict');
    assert.strictEqual(result.reason, 'version_etag_mismatch');
    assert.ok(result.error);
    assert.strictEqual(result.error.code, 'optimistic_concurrency_conflict');
    assert.strictEqual(result.error.reason, 'version_etag_mismatch');
    assert.strictEqual(result.result.kind, 'conflict');
    assert.strictEqual(result.result.reason, 'version_etag_mismatch');
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
    assert.ok(health.governance);
    assert.strictEqual(health.governance.deterministic, true);
    assert.strictEqual(health.governance.failClosed, true);
    assert.strictEqual(typeof health.governance.code, 'string');
    assert.strictEqual(typeof health.governance.reason, 'string');
    assert.ok(Array.isArray(health.governance.reasonCodes));
    assert.ok(health.migrations);
    assert.strictEqual(typeof health.migrations.schemaTable, 'string');
    assert.strictEqual(typeof health.migrations.manifestCount, 'number');
    assert.strictEqual(typeof health.migrations.checksumBaseline, 'string');
    assert.strictEqual(typeof health.migrations.baselineEnforced, 'boolean');
    assert.strictEqual(typeof health.migrations.baselineMismatch, 'boolean');
    assert.ok(health.migrations.checksumValidation);
    assert.strictEqual(typeof health.migrations.checksumValidation.outcome, 'string');
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
        manifestCount: '3.3',
        checksumBaseline: 'abcdef123456',
        baselineEnforced: 1,
        baselineMismatch: 0,
        appliedCount: '3.9',
        appliedVersions: ['003', '001', '002', '001'],
        driftDetected: 1,
        checksumValidation: {
          checkedVersions: ['003', '001', '002', '001'],
          checkedVersionCount: '3.9',
          manifestVersionCount: '3.3',
          manifestChecksumBaseline: 'abcdef123456',
          enforcement: ' fail_closed ',
        },
        lastRunAt: '2026-02-26T01:23:45.000Z',
      },
      lastError: '  transient_failure  ',
    });

    assert.strictEqual(health.status, 'ready');
    assert.strictEqual(health.governance.code, 'planning_persistence_ready');
    assert.strictEqual(health.governance.reason, 'planning_persistence_ready');
    assert.deepStrictEqual(health.errors, ['Alpha', 'beta']);
    assert.strictEqual(health.lastError, 'transient_failure');
    assert.strictEqual(health.migrations.schemaTable, 'custom_schema_versions');
    assert.strictEqual(health.migrations.manifestCount, 3);
    assert.strictEqual(health.migrations.checksumBaseline, 'abcdef123456');
    assert.strictEqual(health.migrations.baselineEnforced, true);
    assert.strictEqual(health.migrations.baselineMismatch, false);
    assert.strictEqual(health.migrations.appliedCount, 3);
    assert.deepStrictEqual(health.migrations.appliedVersions, ['001', '002', '003']);
    assert.strictEqual(health.migrations.checksumValidation.manifestVersionCount, 3);
    assert.strictEqual(health.migrations.checksumValidation.manifestChecksumBaseline, 'abcdef123456');
    assert.strictEqual(health.migrations.checksumValidation.enforcement, 'fail_closed');
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
      acceptanceCriteria: [' first check ', 'second check'],
      acceptanceCriteriaText: '  first check\nsecond check  ',
      targetRepoIds: ['copilot-sdk', ' instruction-engine ', 'copilot-sdk'],
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
    assert.deepStrictEqual(normalized.acceptanceCriteria, ['first check', 'second check']);
    assert.strictEqual(normalized.acceptanceCriteriaText, 'first check\nsecond check');
    assert.deepStrictEqual(normalized.targetRepoIds, ['copilot-sdk', 'instruction-engine']);
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
        acceptanceCriteria: ['Validate planning UI state'],
        acceptanceCriteriaText: 'Validate planning UI state',
        targetRepoIds: ['instruction-engine', 'copilot-sdk'],
        state: 'queued',
        score: 0.9,
        createdAt: '2026-02-26T00:00:00.000Z',
        updatedAt: '2026-02-26T00:00:00.000Z',
      },
    });
    assert.strictEqual(repoWrite.ok, true);
    assert.strictEqual(repoWrite.record.recordId, 'planning-000002');
    assert.deepStrictEqual(repoWrite.record.acceptanceCriteria, ['Validate planning UI state']);
    assert.strictEqual(repoWrite.record.acceptanceCriteriaText, 'Validate planning UI state');
    assert.deepStrictEqual(repoWrite.record.targetRepoIds, ['copilot-sdk', 'instruction-engine']);

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

  await test('persisted compare receipts enforce restart-safe TTL expiration semantics', async () => {
    const client = createDurabilityArtifactClient();

    const persisted = await persistPlanningCompareReceipt(client, {
      receipt: {
        receiptId: 'compare-001',
        actorId: 'user-1',
        repoId: 'repo-1',
        compareHash: 'cmp-hash-1',
        sourceIdsHash: 'sources-hash-1',
        sourceIds: ['source-1'],
        versionVector: { planningRecordsVersion: 2 },
        gateState: 'pass',
        mergeEligible: true,
        reason: 'gate_pass',
        downgrade: { deterministic: true, downgraded: false },
        issuedAt: '2026-02-26T10:00:00.000Z',
        expiresAt: '2026-02-26T10:10:00.000Z',
      },
    });
    assert.strictEqual(persisted.ok, true);

    const beforeExpiry = await readPlanningCompareReceipt(client, {
      receiptId: 'compare-001',
      nowMs: Date.parse('2026-02-26T10:05:00.000Z'),
    });
    assert.strictEqual(beforeExpiry.ok, true);
    assert.strictEqual(beforeExpiry.receipt.receiptId, 'compare-001');

    const afterExpiry = await readPlanningCompareReceipt(client, {
      receiptId: 'compare-001',
      nowMs: Date.parse('2026-02-26T10:11:00.000Z'),
    });
    assert.strictEqual(afterExpiry.ok, false);
    assert.strictEqual(afterExpiry.error.code, 'invalid_compare_receipt');
    assert.strictEqual(afterExpiry.error.reason, 'compare_receipt_expired');

    const reread = await readPlanningCompareReceipt(client, {
      receiptId: 'compare-001',
      nowMs: Date.parse('2026-02-26T10:12:00.000Z'),
    });
    assert.strictEqual(reread.ok, false);
    assert.strictEqual(reread.error.reason, 'compare_receipt_not_found');
  });

  await test('persisted merge intent consume/reset lifecycle is deterministic across retries', async () => {
    const client = createDurabilityArtifactClient();

    const persistedIntent = await persistPlanningMergeIntent(client, {
      token: {
        tokenId: 'intent-001',
        compareReceiptId: 'compare-001',
        actorId: 'user-1',
        repoId: 'repo-1',
        targetId: 'target-1',
        sourceIdsHash: 'sources-hash-1',
        compareHash: 'cmp-hash-1',
        versionVector: { planningRecordsVersion: 2 },
        versionVectorHash: 'vv-1',
        issuedAt: '2026-02-26T10:00:00.000Z',
        expiresAt: '2026-02-26T10:10:00.000Z',
        consumedAt: null,
      },
    });
    assert.strictEqual(persistedIntent.ok, true);

    const consumed = await consumePlanningMergeIntent(client, {
      tokenId: 'intent-001',
      consumedAt: '2026-02-26T10:02:00.000Z',
      nowMs: Date.parse('2026-02-26T10:02:00.000Z'),
    });
    assert.strictEqual(consumed.ok, true);
    assert.strictEqual(consumed.token.tokenId, 'intent-001');
    assert.strictEqual(consumed.token.consumedAt, '2026-02-26T10:02:00.000Z');

    const consumedReplay = await consumePlanningMergeIntent(client, {
      tokenId: 'intent-001',
      consumedAt: '2026-02-26T10:03:00.000Z',
      nowMs: Date.parse('2026-02-26T10:03:00.000Z'),
    });
    assert.strictEqual(consumedReplay.ok, false);
    assert.strictEqual(consumedReplay.error.code, 'invalid_confirmation_token');
    assert.strictEqual(consumedReplay.error.reason, 'token_consumed');

    const reset = await resetPlanningMergeIntentConsumption(client, {
      tokenId: 'intent-001',
    });
    assert.strictEqual(reset.ok, true);
    assert.strictEqual(reset.reset, true);

    const consumedAfterReset = await consumePlanningMergeIntent(client, {
      tokenId: 'intent-001',
      consumedAt: '2026-02-26T10:04:00.000Z',
      nowMs: Date.parse('2026-02-26T10:04:00.000Z'),
    });
    assert.strictEqual(consumedAfterReset.ok, true);
    assert.strictEqual(consumedAfterReset.token.consumedAt, '2026-02-26T10:04:00.000Z');
  });

  await test('WS5A M3 suggestion persistence fail-closes on cross-owner same-id collision', async () => {
    const client = createDurabilityArtifactClient();

    const firstWrite = await persistPlanningSuggestion(client, {
      actorId: 'user-1',
      suggestion: {
        suggestionId: 'suggestion-collision-001',
        actorId: 'user-1',
        repoId: null,
        scope: 'user',
        state: { message: 'owner one' },
        createdAt: '2026-02-26T10:00:00.000Z',
        updatedAt: '2026-02-26T10:00:00.000Z',
      },
    });
    assert.strictEqual(firstWrite.ok, true);
    assert.strictEqual(firstWrite.suggestion.actorId, 'user-1');

    const collisionWrite = await persistPlanningSuggestion(client, {
      actorId: 'user-2',
      suggestion: {
        suggestionId: 'suggestion-collision-001',
        actorId: 'user-2',
        repoId: null,
        scope: 'user',
        state: { message: 'owner two overwrite attempt' },
        createdAt: '2026-02-26T10:01:00.000Z',
        updatedAt: '2026-02-26T10:01:00.000Z',
      },
    });
    assert.strictEqual(collisionWrite.ok, false);
    assert.strictEqual(collisionWrite.error.code, 'scope_visibility_denied');
    assert.strictEqual(collisionWrite.error.reason, 'ownership_conflict');

    const ownerRead = await readPlanningSuggestion(client, {
      actorId: 'user-1',
      suggestionId: 'suggestion-collision-001',
    });
    assert.strictEqual(ownerRead.ok, true);
    assert.strictEqual(ownerRead.suggestion.actorId, 'user-1');
    assert.strictEqual(ownerRead.suggestion.state.message, 'owner one');
  });

  await test('WS5A M3 recap persistence fail-closes on cross-owner same-id collision', async () => {
    const client = createDurabilityArtifactClient();

    const firstWrite = await persistPlanningRecap(client, {
      actorId: 'user-1',
      recap: {
        recapId: 'recap-collision-001',
        actorId: 'user-1',
        repoId: 'repo-1',
        scope: 'repo',
        state: { summary: 'owner one recap' },
        createdAt: '2026-02-26T10:00:00.000Z',
        updatedAt: '2026-02-26T10:00:00.000Z',
      },
    });
    assert.strictEqual(firstWrite.ok, true);
    assert.strictEqual(firstWrite.recap.actorId, 'user-1');

    const collisionWrite = await persistPlanningRecap(client, {
      actorId: 'user-2',
      recap: {
        recapId: 'recap-collision-001',
        actorId: 'user-2',
        repoId: 'repo-2',
        scope: 'repo',
        state: { summary: 'owner two overwrite attempt' },
        createdAt: '2026-02-26T10:01:00.000Z',
        updatedAt: '2026-02-26T10:01:00.000Z',
      },
    });
    assert.strictEqual(collisionWrite.ok, false);
    assert.strictEqual(collisionWrite.error.code, 'scope_visibility_denied');
    assert.strictEqual(collisionWrite.error.reason, 'ownership_conflict');

    const ownerRead = await readPlanningRecap(client, {
      actorId: 'user-1',
      recapId: 'recap-collision-001',
    });
    assert.strictEqual(ownerRead.ok, true);
    assert.strictEqual(ownerRead.recap.actorId, 'user-1');
    assert.strictEqual(ownerRead.recap.state.summary, 'owner one recap');
  });

  await test('roadmap workflow artifacts persist structured phase outputs deterministically', async () => {
    const client = createDurabilityArtifactClient();

    const persisted = await persistRoadmapWorkflowArtifact(client, {
      actorId: 'user-1',
      artifact: {
        artifactId: 'wf-artifact-001',
        actorId: 'user-1',
        repoId: 'repo-1',
        roadmapId: 'RM-core',
        sliceId: 'RM-core-001',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        checksum: 'checksum-001',
        sourceHarness: 'opencode',
        sourceModel: 'anthropic/claude-sonnet-4-5',
        sessionId: 'session-1',
        body: '# Review\n\nLooks good.\n\n## Structured State\n```json\n{"kind":"roadmap.review.result"}\n```',
        structuredState: {
          kind: 'roadmap.review.result',
          roadmapId: 'RM-core',
          sliceId: 'RM-core-001',
          phase: 'review',
          status: 'pass',
          requiresUserDecision: true,
          followUps: [],
        },
        createdAt: '2026-05-17T12:00:00.000Z',
        updatedAt: '2026-05-17T12:05:00.000Z',
      },
    });

    assert.strictEqual(persisted.ok, true);
    assert.strictEqual(persisted.artifact.kind, 'roadmap.review.result');
    assert.strictEqual(persisted.artifact.phase, 'review');
    assert.strictEqual(persisted.artifact.repoId, 'repo-1');

    const readResult = await readRoadmapWorkflowArtifact(client, {
      actorId: 'user-1',
      artifactId: 'wf-artifact-001',
    });

    assert.strictEqual(readResult.ok, true);
    assert.strictEqual(readResult.artifact.roadmapId, 'RM-core');
    assert.strictEqual(readResult.artifact.structuredState.kind, 'roadmap.review.result');
  });

  await test('roadmap workflow artifacts without explicit timestamps use write-time timestamps instead of epoch defaults', async () => {
    const client = createDurabilityArtifactClient();

    const beforeMs = Date.now();
    const persisted = await persistRoadmapWorkflowArtifact(client, {
      actorId: 'user-1',
      artifact: {
        artifactId: 'wf-artifact-implicit-time',
        actorId: 'user-1',
        repoId: 'repo-1',
        roadmapId: 'RM-core',
        sliceId: 'RM-core-001',
        kind: 'roadmap.plan.result',
        phase: 'plan',
        status: 'proposed',
        checksum: 'checksum-implicit-time',
        body: '# Plan\n\n## Structured State\n```json\n{"kind":"roadmap.plan.result"}\n```',
        structuredState: {
          kind: 'roadmap.plan.result',
          roadmapId: 'RM-core',
          sliceId: 'RM-core-001',
          phase: 'plan',
          status: 'proposed',
          requiresUserDecision: false,
          followUps: [],
        },
      },
    });
    const afterMs = Date.now();

    assert.strictEqual(persisted.ok, true);
    assert.notStrictEqual(persisted.artifact.createdAt, '1970-01-01T00:00:00.000Z');
    assert.notStrictEqual(persisted.artifact.updatedAt, '1970-01-01T00:00:00.000Z');
    assert.ok(Date.parse(persisted.artifact.createdAt) >= beforeMs);
    assert.ok(Date.parse(persisted.artifact.createdAt) <= afterMs);
    assert.strictEqual(persisted.artifact.updatedAt, persisted.artifact.createdAt);

    const readResult = await readRoadmapWorkflowArtifact(client, {
      actorId: 'user-1',
      artifactId: 'wf-artifact-implicit-time',
    });

    assert.strictEqual(readResult.ok, true);
    assert.strictEqual(readResult.artifact.createdAt, persisted.artifact.createdAt);
    assert.strictEqual(readResult.artifact.updatedAt, persisted.artifact.updatedAt);
  });

  await test('roadmap workflow artifacts fail-close on cross-owner same-id collision', async () => {
    const client = createDurabilityArtifactClient();

    const firstWrite = await persistRoadmapWorkflowArtifact(client, {
      actorId: 'user-1',
      artifact: {
        artifactId: 'wf-artifact-collision-001',
        actorId: 'user-1',
        roadmapId: 'RM-core',
        kind: 'roadmap.plan.result',
        phase: 'plan',
        status: 'proposed',
        checksum: 'checksum-a',
        body: 'body-a',
        structuredState: { kind: 'roadmap.plan.result' },
        createdAt: '2026-05-17T12:00:00.000Z',
        updatedAt: '2026-05-17T12:00:00.000Z',
      },
    });
    assert.strictEqual(firstWrite.ok, true);

    const collisionWrite = await persistRoadmapWorkflowArtifact(client, {
      actorId: 'user-2',
      artifact: {
        artifactId: 'wf-artifact-collision-001',
        actorId: 'user-2',
        roadmapId: 'RM-core',
        kind: 'roadmap.plan.result',
        phase: 'plan',
        status: 'proposed',
        checksum: 'checksum-b',
        body: 'body-b',
        structuredState: { kind: 'roadmap.plan.result' },
        createdAt: '2026-05-17T12:01:00.000Z',
        updatedAt: '2026-05-17T12:01:00.000Z',
      },
    });

    assert.strictEqual(collisionWrite.ok, false);
    assert.strictEqual(collisionWrite.error.code, 'scope_visibility_denied');
    assert.strictEqual(collisionWrite.error.reason, 'ownership_conflict');
  });

  await test('roadmap workflow artifacts list visible artifacts deterministically by roadmap id', async () => {
    const client = createDurabilityArtifactClient();

    await persistRoadmapWorkflowArtifact(client, {
      actorId: 'user-1',
      artifact: {
        artifactId: 'wf-artifact-older',
        actorId: 'user-1',
        repoId: 'repo-1',
        roadmapId: 'RM-core',
        sliceId: 'RM-core-001',
        kind: 'roadmap.plan.result',
        phase: 'plan',
        status: 'proposed',
        checksum: 'checksum-older',
        body: '# Plan\n\n## Structured State\n```json\n{"kind":"roadmap.plan.result"}\n```',
        structuredState: {
          kind: 'roadmap.plan.result',
          roadmapId: 'RM-core',
          sliceId: 'RM-core-001',
          phase: 'plan',
          status: 'proposed',
          requiresUserDecision: true,
          followUps: [],
        },
        createdAt: '2026-05-16T12:00:00.000Z',
        updatedAt: '2026-05-16T12:00:00.000Z',
      },
    });
    await persistRoadmapWorkflowArtifact(client, {
      actorId: 'user-1',
      artifact: {
        artifactId: 'wf-artifact-newer',
        actorId: 'user-1',
        repoId: 'repo-1',
        roadmapId: 'RM-core',
        sliceId: 'RM-core-001',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        checksum: 'checksum-newer',
        body: '# Review\n\n## Structured State\n```json\n{"kind":"roadmap.review.result"}\n```',
        structuredState: {
          kind: 'roadmap.review.result',
          roadmapId: 'RM-core',
          sliceId: 'RM-core-001',
          phase: 'review',
          status: 'pass',
          requiresUserDecision: false,
          followUps: [],
        },
        createdAt: '2026-05-17T12:00:00.000Z',
        updatedAt: '2026-05-17T12:00:00.000Z',
      },
    });
    await persistRoadmapWorkflowArtifact(client, {
      actorId: 'user-2',
      artifact: {
        artifactId: 'wf-artifact-hidden',
        actorId: 'user-2',
        repoId: 'repo-1',
        roadmapId: 'RM-core',
        sliceId: 'RM-core-002',
        kind: 'roadmap.plan.result',
        phase: 'plan',
        status: 'proposed',
        checksum: 'checksum-hidden',
        body: '# Plan\n\n## Structured State\n```json\n{"kind":"roadmap.plan.result"}\n```',
        structuredState: {
          kind: 'roadmap.plan.result',
          roadmapId: 'RM-core',
          sliceId: 'RM-core-002',
          phase: 'plan',
          status: 'proposed',
          requiresUserDecision: false,
          followUps: [],
        },
        createdAt: '2026-05-18T12:00:00.000Z',
        updatedAt: '2026-05-18T12:00:00.000Z',
      },
    });
    await persistRoadmapWorkflowArtifact(client, {
      actorId: 'user-1',
      artifact: {
        artifactId: 'wf-artifact-global',
        actorId: 'user-1',
        roadmapId: 'RM-core',
        sliceId: 'RM-core-003',
        kind: 'roadmap.plan.result',
        phase: 'plan',
        status: 'proposed',
        checksum: 'checksum-global',
        body: '# Plan\n\n## Structured State\n```json\n{"kind":"roadmap.plan.result"}\n```',
        structuredState: {
          kind: 'roadmap.plan.result',
          roadmapId: 'RM-core',
          sliceId: 'RM-core-003',
          phase: 'plan',
          status: 'proposed',
          requiresUserDecision: false,
          followUps: [],
        },
        createdAt: '2026-05-19T12:00:00.000Z',
        updatedAt: '2026-05-19T12:00:00.000Z',
      },
    });

    const listed = await listRoadmapWorkflowArtifacts(client, {
      actorId: 'user-1',
      repoId: 'repo-1',
      roadmapId: 'RM-core',
    });

    assert.strictEqual(listed.ok, true);
    assert.deepStrictEqual(listed.artifacts.map((artifact) => artifact.artifactId), [
      'wf-artifact-newer',
      'wf-artifact-older',
    ]);
  });

  await test('persisted merge idempotency ledger enforces deterministic payload conflicts and TTL expiry', async () => {
    const client = createDurabilityArtifactClient();

    const firstWrite = await persistPlanningMergeIdempotencyRecord(client, {
      idempotencyKey: 'merge-idem-1',
      actorId: 'user-1',
      repoId: 'repo-1',
      operationType: 'merge',
      targetId: 'target-1',
      sourceIdsHash: 'sources-hash-1',
      compareHash: 'cmp-hash-1',
      payloadHash: 'payload-hash-1',
      mergeRecordId: 'planning-merge-1',
      response: { mergeAccepted: true },
      nowMs: Date.parse('2026-02-26T10:00:00.000Z'),
      ttlMs: 60_000,
    });
    assert.strictEqual(firstWrite.ok, true);
    assert.strictEqual(firstWrite.replay, false);

    const replayWrite = await persistPlanningMergeIdempotencyRecord(client, {
      idempotencyKey: 'merge-idem-1',
      actorId: 'user-1',
      repoId: 'repo-1',
      operationType: 'merge',
      targetId: 'target-1',
      sourceIdsHash: 'sources-hash-1',
      compareHash: 'cmp-hash-1',
      payloadHash: 'payload-hash-1',
      mergeRecordId: 'planning-merge-1',
      response: { mergeAccepted: true },
      nowMs: Date.parse('2026-02-26T10:00:10.000Z'),
      ttlMs: 60_000,
    });
    assert.strictEqual(replayWrite.ok, true);
    assert.strictEqual(replayWrite.replay, true);

    const conflictWrite = await persistPlanningMergeIdempotencyRecord(client, {
      idempotencyKey: 'merge-idem-1',
      actorId: 'user-1',
      repoId: 'repo-1',
      operationType: 'merge',
      targetId: 'target-1',
      sourceIdsHash: 'sources-hash-1',
      compareHash: 'cmp-hash-1',
      payloadHash: 'payload-hash-2',
      mergeRecordId: 'planning-merge-1',
      response: { mergeAccepted: true },
      nowMs: Date.parse('2026-02-26T10:00:20.000Z'),
      ttlMs: 60_000,
    });
    assert.strictEqual(conflictWrite.ok, false);
    assert.strictEqual(conflictWrite.error.code, 'idempotency_conflict');
    assert.strictEqual(conflictWrite.error.reason, 'idempotency_key_payload_mismatch');

    const beforeExpiry = await readPlanningMergeIdempotencyRecord(client, {
      idempotencyKey: 'merge-idem-1',
      nowMs: Date.parse('2026-02-26T10:00:30.000Z'),
    });
    assert.strictEqual(beforeExpiry.ok, true);
    assert.ok(beforeExpiry.record);

    const afterExpiry = await readPlanningMergeIdempotencyRecord(client, {
      idempotencyKey: 'merge-idem-1',
      nowMs: Date.parse('2026-02-26T10:02:00.000Z'),
    });
    assert.strictEqual(afterExpiry.ok, true);
    assert.strictEqual(afterExpiry.record, null);

    const deletion = await deletePlanningMergeIdempotencyRecord(client, {
      idempotencyKey: 'merge-idem-1',
    });
    assert.strictEqual(deletion.ok, true);
    assert.strictEqual(deletion.deleted, false);
  });

  await test('deletePersistedPlanningRecordById supports rollback compensation safely', async () => {
    const client = createDurabilityArtifactClient({
      initialPlanningRows: [
        {
          record_id: 'planning-rollback-001',
          owner_id: 'user-1',
          repo_id: 'repo-1',
          scope: 'repo',
          state: {
            recordId: 'planning-rollback-001',
            ownerId: 'user-1',
            repoId: 'repo-1',
            scope: 'repo',
            title: 'rollback',
            summary: 'rollback',
            state: 'queued',
            score: 1,
            createdAt: '2026-02-26T10:00:00.000Z',
            updatedAt: '2026-02-26T10:00:00.000Z',
          },
          created_at: '2026-02-26T10:00:00.000Z',
          updated_at: '2026-02-26T10:00:00.000Z',
        },
      ],
    });

    const deniedDelete = await deletePersistedPlanningRecordById(client, {
      actorId: 'user-2',
      recordId: 'planning-rollback-001',
    });
    assert.strictEqual(deniedDelete.ok, false);
    assert.strictEqual(deniedDelete.error.code, 'scope_visibility_denied');

    const deleted = await deletePersistedPlanningRecordById(client, {
      actorId: 'user-1',
      recordId: 'planning-rollback-001',
    });
    assert.strictEqual(deleted.ok, true);
    assert.strictEqual(deleted.deleted, true);

    const deletedAgain = await deletePersistedPlanningRecordById(client, {
      actorId: 'user-1',
      recordId: 'planning-rollback-001',
    });
    assert.strictEqual(deletedAgain.ok, true);
    assert.strictEqual(deletedAgain.deleted, false);
  });

  await test('retention engine supports dry-run and execute report envelopes deterministically', async () => {
    const client = createPlanningRecordClient([
      {
        record_id: 'planning-old-001',
        owner_id: 'user-1',
        repo_id: 'repo-1',
        scope: 'repo',
        state: {
          recordId: 'planning-old-001',
          ownerId: 'user-1',
          repoId: 'repo-1',
          scope: 'repo',
          title: 'old',
          summary: 'old',
          state: 'thought',
          score: 0.1,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
      {
        record_id: 'planning-new-001',
        owner_id: 'user-1',
        repo_id: null,
        scope: 'user',
        state: {
          recordId: 'planning-new-001',
          ownerId: 'user-1',
          repoId: null,
          scope: 'user',
          title: 'new',
          summary: 'new',
          state: 'thought',
          score: 0.2,
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T00:00:00.000Z',
        },
        created_at: '2026-02-26T00:00:00.000Z',
        updated_at: '2026-02-26T00:00:00.000Z',
      },
    ]);

    const dryRun = await runPlanningRetention(client, {
      mode: 'dry-run',
      cutoffUpdatedBefore: '2026-01-01T00:00:00.000Z',
    });
    assert.strictEqual(dryRun.ok, true);
    assert.strictEqual(dryRun.deterministic, true);
    assert.strictEqual(dryRun.mode, 'dry-run');
    assert.strictEqual(dryRun.status, 'dry-run');
    assert.strictEqual(dryRun.candidateCount, 1);
    assert.strictEqual(dryRun.deletedCount, 0);
    assert.deepStrictEqual(dryRun.candidateRecordIds, ['planning-old-001']);
    assert.deepStrictEqual(dryRun.deletedRecordIds, []);

    const execute = await runPlanningRetention(client, {
      mode: 'execute',
      cutoffUpdatedBefore: '2026-01-01T00:00:00.000Z',
    });
    assert.strictEqual(execute.ok, true);
    assert.strictEqual(execute.deterministic, true);
    assert.strictEqual(execute.mode, 'execute');
    assert.strictEqual(execute.status, 'executed');
    assert.strictEqual(execute.candidateCount, 1);
    assert.strictEqual(execute.deletedCount, 1);
    assert.deepStrictEqual(execute.deletedRecordIds, ['planning-old-001']);

    const remaining = snapshotPlanningRecordRows(client).map((row) => row.record_id).sort();
    assert.deepStrictEqual(remaining, ['planning-new-001']);
  });

  await test('export/import contract is idempotent across repeated import', async () => {
    const source = createPlanningRecordClient([
      {
        record_id: 'planning-010',
        owner_id: 'user-1',
        repo_id: 'repo-1',
        scope: 'repo',
        state: {
          recordId: 'planning-010',
          ownerId: 'user-1',
          repoId: 'repo-1',
          scope: 'repo',
          title: 'A',
          summary: 'A',
          state: 'thought',
          score: 0.1,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      {
        record_id: 'planning-011',
        owner_id: 'user-2',
        repo_id: null,
        scope: 'user',
        state: {
          recordId: 'planning-011',
          ownerId: 'user-2',
          repoId: null,
          scope: 'user',
          title: 'B',
          summary: 'B',
          state: 'queued',
          score: 0.9,
          createdAt: '2026-02-02T00:00:00.000Z',
          updatedAt: '2026-02-02T00:00:00.000Z',
        },
        created_at: '2026-02-02T00:00:00.000Z',
        updated_at: '2026-02-02T00:00:00.000Z',
      },
    ]);
    const target = createPlanningRecordClient();

    const exported = await exportPlanningPersistenceSnapshot(source);
    assert.strictEqual(exported.ok, true);
    assert.strictEqual(exported.kind, 'planning.persistence.export');
    assert.strictEqual(exported.recordCount, 2);
    assert.strictEqual(typeof exported.checksum, 'string');
    assert.strictEqual(exported.checksum.length, 64);

    const firstImport = await importPlanningPersistenceSnapshot(target, exported);
    assert.strictEqual(firstImport.ok, true);
    assert.strictEqual(firstImport.deterministic, true);
    assert.strictEqual(firstImport.kind, 'planning.persistence.import');
    assert.strictEqual(firstImport.sourceRecordCount, 2);
    assert.strictEqual(firstImport.uniqueRecordCount, 2);
    assert.strictEqual(firstImport.createdCount, 2);
    assert.strictEqual(firstImport.updatedCount, 0);
    assert.strictEqual(firstImport.replayedCount, 0);

    const secondImport = await importPlanningPersistenceSnapshot(target, exported);
    assert.strictEqual(secondImport.ok, true);
    assert.strictEqual(secondImport.deterministic, true);
    assert.strictEqual(secondImport.createdCount, 0);
    assert.strictEqual(secondImport.updatedCount, 0);
    assert.strictEqual(secondImport.replayedCount, 2);

    const targetRows = snapshotPlanningRecordRows(target);
    assert.strictEqual(targetRows.length, 2);
  });

  await test('import rejects conflicting duplicate records deterministically', async () => {
    const client = createPlanningRecordClient();

    const result = await importPlanningPersistenceSnapshot(client, {
      records: [
        {
          recordId: 'planning-duplicate-1',
          scope: 'user',
          ownerId: 'user-1',
          title: 'Version 1',
          summary: 'first',
          state: 'thought',
          score: 0.1,
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-20T00:00:00.000Z',
        },
        {
          recordId: 'planning-duplicate-1',
          scope: 'user',
          ownerId: 'user-1',
          title: 'Version 2',
          summary: 'changed',
          state: 'queued',
          score: 0.2,
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-20T00:01:00.000Z',
        },
      ],
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
    assert.strictEqual(result.error.code, 'planning_persistence_import_conflicting_duplicate');
    assert.strictEqual(result.error.reason, 'duplicate_record_id_conflict');
  });

  await test('corruption scan blocks until recovery conditions are met', async () => {
    const client = createPlanningRecordClient([
      {
        record_id: 'planning-valid-1',
        owner_id: 'user-1',
        repo_id: null,
        scope: 'user',
        state: {
          recordId: 'planning-valid-1',
          ownerId: 'user-1',
          repoId: null,
          scope: 'user',
          title: 'valid',
          summary: 'valid',
          state: 'thought',
          score: 0.2,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      {
        record_id: 'planning-corrupt-1',
        owner_id: '',
        repo_id: null,
        scope: 'invalid_scope',
        state: {
          recordId: 'planning-corrupt-1',
          ownerId: '',
          repoId: null,
          scope: 'invalid_scope',
          title: 'broken',
          summary: 'broken',
          state: 'thought',
          score: 0.2,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      },
    ]);

    const blockedScan = await scanPlanningPersistenceCorruption(client);
    assert.strictEqual(blockedScan.ok, true);
    assert.strictEqual(blockedScan.deterministic, true);
    assert.strictEqual(blockedScan.blocked, true);
    assert.strictEqual(blockedScan.recoveryRequired, true);
    assert.strictEqual(blockedScan.code, 'planning_persistence_corruption_detected');
    assert.ok(blockedScan.findingCount >= 1);

    client.recordsById.delete('planning-corrupt-1');

    const recoveredScan = await scanPlanningPersistenceCorruption(client);
    assert.strictEqual(recoveredScan.ok, true);
    assert.strictEqual(recoveredScan.deterministic, true);
    assert.strictEqual(recoveredScan.blocked, false);
    assert.strictEqual(recoveredScan.recoveryRequired, false);
    assert.strictEqual(recoveredScan.code, 'planning_persistence_corruption_clear');
    assert.strictEqual(recoveredScan.findingCount, 0);
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
