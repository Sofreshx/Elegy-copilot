const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION,
  MESSAGING_GATEWAY_CONFIG_CONTRACT_VERSION,
  MESSAGING_GATEWAY_READINESS_SCHEMA_VERSION,
  MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION,
  MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_DEFAULT_SAMPLE_CAPACITY,
  MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
  resolveContractCompatibilitySource,
  buildContractCompatibility,
  buildMessagingGatewayConfigMetadata,
  buildMessagingGatewayReadinessMetadata,
  buildEmptyMessagingGatewayDiscoveryTelemetrySummary,
} = require('../dist');

test('gateway config metadata builder stays canonical', () => {
  assert.deepEqual(
    buildMessagingGatewayConfigMetadata({ normalizedFrom: 'v0' }),
    {
      configVersion: MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION,
      schemaVersion: MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION,
      contractVersion: MESSAGING_GATEWAY_CONFIG_CONTRACT_VERSION,
      compatibility: {
        normalizedFrom: 'v0',
        deterministic: true,
      },
    },
  );
});

test('compatibility source detection treats explicit markers as v1', () => {
  assert.equal(resolveContractCompatibilitySource({}), 'v0');
  assert.equal(resolveContractCompatibilitySource({ schemaVersion: 1 }), 'v1');
  assert.equal(resolveContractCompatibilitySource({ contractVersion: 'custom' }), 'v1');
  assert.equal(resolveContractCompatibilitySource({ configVersion: 2 }), 'v1');
});

test('gateway readiness metadata and discovery telemetry builders stay deterministic', () => {
  assert.deepEqual(
    buildMessagingGatewayReadinessMetadata({ normalizedFrom: 'v1' }),
    {
      schemaVersion: MESSAGING_GATEWAY_READINESS_SCHEMA_VERSION,
      contractVersion: MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION,
      compatibility: buildContractCompatibility('v1'),
    },
  );

  assert.deepEqual(
    buildEmptyMessagingGatewayDiscoveryTelemetrySummary(),
    {
      contractVersion: MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
      sample: {
        capacity: MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_DEFAULT_SAMPLE_CAPACITY,
        size: 0,
        dropped: 0,
        deterministic: true,
      },
      countersByReason: {
        keyword_miss: 0,
        ambiguity: 0,
        stale_map: 0,
        no_route: 0,
      },
      recent: [],
    },
  );
});
