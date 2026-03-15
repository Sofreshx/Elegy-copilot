export type ContractCompatibilitySource = 'v0' | 'v1';

export interface ContractCompatibility {
  normalizedFrom: ContractCompatibilitySource;
  deterministic: true;
}

export const MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION = 1;
export const MESSAGING_GATEWAY_CONFIG_CONTRACT_VERSION = 'messaging_gateway_config_v1';
export const MESSAGING_GATEWAY_READINESS_SCHEMA_VERSION = 1;
export const MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION = 'messaging_gateway_readiness_v1';
export const MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION = 'skill_discovery_telemetry_v1';
export const MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_DEFAULT_SAMPLE_CAPACITY = 12;

export type MessagingGatewayReadinessState = 'ready' | 'not_ready' | 'disconnected';
export type MessagingGatewayReadinessReasonCode =
  | 'gateway_ready'
  | 'gateway_not_ready'
  | 'gateway_disconnected';
export type MessagingGatewayDiscoveryMissReason =
  | 'keyword_miss'
  | 'ambiguity'
  | 'stale_map'
  | 'no_route';

export interface MessagingGatewayConfigMetadata {
  configVersion: number;
  schemaVersion: typeof MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION;
  contractVersion: typeof MESSAGING_GATEWAY_CONFIG_CONTRACT_VERSION;
  compatibility: ContractCompatibility;
}

export interface MessagingGatewayReadinessMetadata {
  schemaVersion: typeof MESSAGING_GATEWAY_READINESS_SCHEMA_VERSION;
  contractVersion: typeof MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION;
  compatibility: ContractCompatibility;
}

export interface MessagingGatewayDiscoveryTelemetrySummary {
  contractVersion: typeof MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION;
  sample: {
    capacity: number;
    size: number;
    dropped: number;
    deterministic: true;
  };
  countersByReason: Record<MessagingGatewayDiscoveryMissReason, number>;
  recent: Array<{
    sequence: number;
    reason: MessagingGatewayDiscoveryMissReason;
    command: string;
    detail: string;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asFiniteInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

export function resolveContractCompatibilitySource(
  input: unknown,
): ContractCompatibilitySource {
  const source = isRecord(input) ? input : {};
  return source.configVersion !== undefined
    || source.schemaVersion !== undefined
    || source.contractVersion !== undefined
    ? 'v1'
    : 'v0';
}

export function buildContractCompatibility(
  normalizedFrom: ContractCompatibilitySource = 'v1',
): ContractCompatibility {
  return {
    normalizedFrom,
    deterministic: true,
  };
}

export function buildMessagingGatewayConfigMetadata(input: {
  normalizedFrom?: ContractCompatibilitySource;
  configVersion?: number;
} = {}): MessagingGatewayConfigMetadata {
  return {
    configVersion:
      asFiniteInteger(input.configVersion)
      ?? MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION,
    schemaVersion: MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION,
    contractVersion: MESSAGING_GATEWAY_CONFIG_CONTRACT_VERSION,
    compatibility: buildContractCompatibility(input.normalizedFrom ?? 'v1'),
  };
}

export function buildMessagingGatewayReadinessMetadata(input: {
  normalizedFrom?: ContractCompatibilitySource;
} = {}): MessagingGatewayReadinessMetadata {
  return {
    schemaVersion: MESSAGING_GATEWAY_READINESS_SCHEMA_VERSION,
    contractVersion: MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION,
    compatibility: buildContractCompatibility(input.normalizedFrom ?? 'v1'),
  };
}

export function buildEmptyMessagingGatewayDiscoveryTelemetrySummary(input: {
  capacity?: number;
} = {}): MessagingGatewayDiscoveryTelemetrySummary {
  const requestedCapacity = asFiniteInteger(input.capacity);
  const capacity = requestedCapacity !== undefined && requestedCapacity >= 0
    ? requestedCapacity
    : MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_DEFAULT_SAMPLE_CAPACITY;

  return {
    contractVersion: MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
    sample: {
      capacity,
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
  };
}
