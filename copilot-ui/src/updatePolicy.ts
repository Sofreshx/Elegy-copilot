import {
  evaluateRollbackCandidate,
  evaluateRollbackCurrentVersion,
  RollbackPolicyResolution,
  RollbackReasonCode,
} from './rollbackPolicy';

export type UpdateChannel = 'stable' | 'prerelease';
export type ResolvedUpdateChannel = UpdateChannel | 'unknown';
export type UpdatePolicyReasonCode =
  | RollbackReasonCode
  | 'allowed_by_channel_policy'
  | 'stable_channel_blocks_prerelease_candidate'
  | 'update_channel_invalid';

export interface DesktopReleaseChannelContract {
  channel: ResolvedUpdateChannel;
  sdkChannel: ResolvedUpdateChannel;
  cliChannel: ResolvedUpdateChannel;
}

export interface UpdatePolicyInput {
  appVersion?: string;
  explicitChannel?: string | null;
  candidateVersion?: string | null;
  rollbackPolicy?: RollbackPolicyResolution | null;
}

export interface UpdateDecision {
  channel: ResolvedUpdateChannel;
  allowed: boolean;
  reason: UpdatePolicyReasonCode;
}

export type UpdateChannelResolution =
  | {
      ok: true;
      channel: UpdateChannel;
    }
  | {
      ok: false;
      channel: ResolvedUpdateChannel;
      reason: 'update_channel_invalid';
      explicitChannel: string;
    };

export type DesktopReleaseChannelContractResolution =
  | {
      ok: true;
      contract: DesktopReleaseChannelContract;
    }
  | {
      ok: false;
      contract: DesktopReleaseChannelContract;
      reason: 'update_channel_invalid';
      explicitChannel: string;
    };

export function isPrereleaseVersion(version: string | null | undefined): boolean {
  const value = String(version || '').trim();
  if (!value) return false;
  return /^\d+\.\d+\.\d+-.+/.test(value);
}

function inferUpdateChannel(appVersion: string | null | undefined): UpdateChannel {
  return isPrereleaseVersion(appVersion || '') ? 'prerelease' : 'stable';
}

export function resolveUpdateChannel(input: UpdatePolicyInput): UpdateChannelResolution {
  const explicit = String(input.explicitChannel || '').trim().toLowerCase();
  if (!explicit) {
    return {
      ok: true,
      channel: inferUpdateChannel(input.appVersion || ''),
    };
  }
  if (explicit === 'stable' || explicit === 'prerelease') {
    return {
      ok: true,
      channel: explicit,
    };
  }

  return {
    ok: false,
    channel: 'unknown',
    reason: 'update_channel_invalid',
    explicitChannel: explicit,
  };
}

export function resolveDesktopReleaseChannelContract(input: UpdatePolicyInput): DesktopReleaseChannelContractResolution {
  const channelResolution = resolveUpdateChannel(input);
  const contract = {
    channel: channelResolution.channel,
    sdkChannel: channelResolution.channel,
    cliChannel: channelResolution.channel,
  };
  if (!channelResolution.ok) {
    return {
      ok: false,
      contract,
      reason: channelResolution.reason,
      explicitChannel: channelResolution.explicitChannel,
    };
  }
  return {
    ok: true,
    contract,
  };
}

export function evaluateUpdateCheck(input: UpdatePolicyInput): UpdateDecision {
  const channelResolution = resolveUpdateChannel(input);

  if (!channelResolution.ok) {
    return {
      channel: channelResolution.channel,
      allowed: false,
      reason: channelResolution.reason,
    };
  }

  const channel = channelResolution.channel;

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
  const channelResolution = resolveUpdateChannel(input);

  if (!channelResolution.ok) {
    return {
      channel: channelResolution.channel,
      allowed: false,
      reason: channelResolution.reason,
    };
  }

  const channel = channelResolution.channel;
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
