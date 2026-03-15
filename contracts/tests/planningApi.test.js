const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLANNING_API_CONTRACT_VERSION,
  buildPlanningApiEnvelope,
  buildPlanningApiErrorEnvelope,
} = require('../dist');

test('planning api envelope builder keeps shared contract metadata authoritative', () => {
  assert.deepEqual(
    buildPlanningApiEnvelope('planning.persistence.export', {
      code: 'planning_persistence_export_ready',
      reason: 'planning_persistence_export_ready',
    }),
    {
      code: 'planning_persistence_export_ready',
      reason: 'planning_persistence_export_ready',
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.export',
      deterministic: true,
    },
  );
});

test('planning api error envelope builder preserves payload details', () => {
  assert.deepEqual(
    buildPlanningApiErrorEnvelope(
      'planning.persistence.init',
      {
        code: 'planning_persistence_init_failed',
        reason: 'planning_persistence_init_failed',
        message: 'boom',
      },
      {
        ready: false,
      },
    ),
    {
      ready: false,
      error: {
        code: 'planning_persistence_init_failed',
        reason: 'planning_persistence_init_failed',
        message: 'boom',
      },
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.init',
      deterministic: true,
    },
  );
});
