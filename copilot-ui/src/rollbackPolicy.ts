export type RollbackChannel = 'stable' | 'prerelease';

export interface RollbackPolicy {
  updatesEnabled: boolean;
  minimumSafeVersion?: string;
  minimumSafeVersionsByChannel?: Partial<Record<RollbackChannel, string>>;
  channelVersionCeilings?: Partial<Record<RollbackChannel, string>>;
}

export type RollbackSourceReasonCode = 'rollback_policy_source_unavailable' | 'rollback_policy_malformed';

export type RollbackReasonCode =
  | RollbackSourceReasonCode
  | 'updates_disabled_globally'
  | 'current_version_invalid'
  | 'candidate_version_invalid'
  | 'current_version_below_minimum_safe'
  | 'candidate_version_below_minimum_safe'
  | 'candidate_version_above_channel_ceiling'
  | 'allowed_by_rollback_policy';

export type RollbackPolicyResolution =
  | {
      ok: true;
      policy: RollbackPolicy;
    }
  | {
      ok: false;
      reason: RollbackSourceReasonCode;
    };

export interface RollbackDecision {
  allowed: boolean;
  reason: RollbackReasonCode;
}

export interface RollbackCurrentVersionInput {
  channel: RollbackChannel;
  currentVersion?: string | null;
  rollbackPolicy: RollbackPolicyResolution;
}

export interface RollbackCandidateInput extends RollbackCurrentVersionInput {
  candidateVersion?: string | null;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSemver(version: string | null | undefined): ParsedSemver | null {
  const value = String(version || '').trim();
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;

  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = a[index];
    const right = b[index];

    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftIsNumeric = /^\d+$/.test(left);
    const rightIsNumeric = /^\d+$/.test(right);
    if (leftIsNumeric && rightIsNumeric) {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (leftNumber > rightNumber) return 1;
      if (leftNumber < rightNumber) return -1;
      continue;
    }
    if (leftIsNumeric) return -1;
    if (rightIsNumeric) return 1;
    return left > right ? 1 : -1;
  }

  return 0;
}

function compareSemver(left: string, right: string): number {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);
  if (!leftVersion || !rightVersion) {
    return 0;
  }

  if (leftVersion.major !== rightVersion.major) {
    return leftVersion.major > rightVersion.major ? 1 : -1;
  }
  if (leftVersion.minor !== rightVersion.minor) {
    return leftVersion.minor > rightVersion.minor ? 1 : -1;
  }
  if (leftVersion.patch !== rightVersion.patch) {
    return leftVersion.patch > rightVersion.patch ? 1 : -1;
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function normalizeVersionString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || !parseSemver(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeVersionMap(
  value: unknown,
): Partial<Record<RollbackChannel, string>> | null {
  if (value === undefined) {
    return {};
  }
  if (!isObjectRecord(value)) {
    return null;
  }

  const normalized: Partial<Record<RollbackChannel, string>> = {};
  const allowedKeys: RollbackChannel[] = ['stable', 'prerelease'];
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key as RollbackChannel)) {
      return null;
    }
    const version = normalizeVersionString(value[key]);
    if (!version) {
      return null;
    }
    normalized[key as RollbackChannel] = version;
  }

  return normalized;
}

function resolveMinimumSafeVersion(policy: RollbackPolicy, channel: RollbackChannel): string | null {
  const channelVersion = policy.minimumSafeVersionsByChannel && policy.minimumSafeVersionsByChannel[channel];
  if (channelVersion) {
    return channelVersion;
  }
  return policy.minimumSafeVersion || null;
}

function resolveChannelCeiling(policy: RollbackPolicy, channel: RollbackChannel): string | null {
  return (policy.channelVersionCeilings && policy.channelVersionCeilings[channel]) || null;
}

function normalizeRollbackPolicy(value: unknown): RollbackPolicy | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  if (typeof value.updatesEnabled !== 'boolean') {
    return null;
  }

  let minimumSafeVersion: string | undefined;
  if (value.minimumSafeVersion !== undefined) {
    minimumSafeVersion = normalizeVersionString(value.minimumSafeVersion) || undefined;
  }
  if (value.minimumSafeVersion !== undefined && !minimumSafeVersion) {
    return null;
  }

  const minimumSafeVersionsByChannel = normalizeVersionMap(value.minimumSafeVersionsByChannel);
  if (minimumSafeVersionsByChannel === null) {
    return null;
  }

  const channelVersionCeilings = normalizeVersionMap(value.channelVersionCeilings);
  if (channelVersionCeilings === null) {
    return null;
  }

  return {
    updatesEnabled: value.updatesEnabled,
    minimumSafeVersion,
    minimumSafeVersionsByChannel,
    channelVersionCeilings,
  };
}

export function resolveRollbackPolicy(rawPolicy: string | null | undefined): RollbackPolicyResolution {
  const value = String(rawPolicy || '').trim();
  if (!value) {
    return {
      ok: false,
      reason: 'rollback_policy_source_unavailable',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      ok: false,
      reason: 'rollback_policy_malformed',
    };
  }

  const policy = normalizeRollbackPolicy(parsed);
  if (!policy) {
    return {
      ok: false,
      reason: 'rollback_policy_malformed',
    };
  }

  return {
    ok: true,
    policy,
  };
}

export function evaluateRollbackCurrentVersion(input: RollbackCurrentVersionInput): RollbackDecision {
  if (!input.rollbackPolicy.ok) {
    return {
      allowed: false,
      reason: input.rollbackPolicy.reason,
    };
  }

  const policy = input.rollbackPolicy.policy;
  if (!policy.updatesEnabled) {
    return {
      allowed: false,
      reason: 'updates_disabled_globally',
    };
  }

  const currentVersion = String(input.currentVersion || '').trim();
  if (!parseSemver(currentVersion)) {
    return {
      allowed: false,
      reason: 'current_version_invalid',
    };
  }

  const minimumSafeVersion = resolveMinimumSafeVersion(policy, input.channel);
  if (minimumSafeVersion && compareSemver(currentVersion, minimumSafeVersion) < 0) {
    return {
      allowed: false,
      reason: 'current_version_below_minimum_safe',
    };
  }

  return {
    allowed: true,
    reason: 'allowed_by_rollback_policy',
  };
}

export function evaluateRollbackCandidate(input: RollbackCandidateInput): RollbackDecision {
  const currentDecision = evaluateRollbackCurrentVersion(input);
  if (!currentDecision.allowed) {
    return currentDecision;
  }

  const policy = input.rollbackPolicy.ok ? input.rollbackPolicy.policy : null;
  if (!policy) {
    return {
      allowed: false,
      reason: 'rollback_policy_malformed',
    };
  }

  const candidateVersion = String(input.candidateVersion || '').trim();
  if (!parseSemver(candidateVersion)) {
    return {
      allowed: false,
      reason: 'candidate_version_invalid',
    };
  }

  const minimumSafeVersion = resolveMinimumSafeVersion(policy, input.channel);
  if (minimumSafeVersion && compareSemver(candidateVersion, minimumSafeVersion) < 0) {
    return {
      allowed: false,
      reason: 'candidate_version_below_minimum_safe',
    };
  }

  const channelCeiling = resolveChannelCeiling(policy, input.channel);
  if (channelCeiling && compareSemver(candidateVersion, channelCeiling) > 0) {
    return {
      allowed: false,
      reason: 'candidate_version_above_channel_ceiling',
    };
  }

  return {
    allowed: true,
    reason: 'allowed_by_rollback_policy',
  };
}
