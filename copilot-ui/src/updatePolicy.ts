import {
  evaluateRollbackCandidate,
  evaluateRollbackCurrentVersion,
  RollbackPolicyResolution,
} from './rollbackPolicy';

export type UpdateChannel = 'stable' | 'prerelease';

export interface UpdatePolicyInput {
  appVersion?: string;
  explicitChannel?: string | null;
  candidateVersion?: string | null;
  rollbackPolicy?: RollbackPolicyResolution | null;
}

export interface UpdateDecision {
  channel: UpdateChannel;
  allowed: boolean;
  reason: string;
}

export function isPrereleaseVersion(version: string | null | undefined): boolean {
  const value = String(version || '').trim();
  if (!value) return false;
  return /^\d+\.\d+\.\d+-.+/.test(value);
}

export function resolveUpdateChannel(input: UpdatePolicyInput): UpdateChannel {
  const explicit = String(input.explicitChannel || '').trim().toLowerCase();
  if (explicit === 'stable') return 'stable';
  if (explicit === 'prerelease') return 'prerelease';

  return isPrereleaseVersion(input.appVersion || '') ? 'prerelease' : 'stable';
}

export function evaluateUpdateCheck(input: UpdatePolicyInput): UpdateDecision {
  const channel = resolveUpdateChannel(input);

  if (input.rollbackPolicy) {
    const rollbackDecision = evaluateRollbackCurrentVersion({
      channel,
      currentVersion: input.appVersion,
      rollbackPolicy: input.rollbackPolicy,
    });

    if (!rollbackDecision.allowed) {
      return {
        channel,
        allowed: false,
        reason: rollbackDecision.reason,
      };
    }
  }

  return {
    channel,
    allowed: true,
    reason: 'allowed_by_channel_policy',
  };
}

export function evaluateUpdateCandidate(input: UpdatePolicyInput): UpdateDecision {
  const channel = resolveUpdateChannel(input);
  const candidateIsPrerelease = isPrereleaseVersion(input.candidateVersion || '');

  if (channel === 'stable' && candidateIsPrerelease) {
    return {
      channel,
      allowed: false,
      reason: 'stable_channel_blocks_prerelease_candidate',
    };
  }

  if (input.rollbackPolicy) {
    const rollbackDecision = evaluateRollbackCandidate({
      channel,
      currentVersion: input.appVersion,
      candidateVersion: input.candidateVersion,
      rollbackPolicy: input.rollbackPolicy,
    });

    if (!rollbackDecision.allowed) {
      return {
        channel,
        allowed: false,
        reason: rollbackDecision.reason,
      };
    }
  }

  return {
    channel,
    allowed: true,
    reason: 'allowed_by_channel_policy',
  };
}
