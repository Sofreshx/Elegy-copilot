"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPrereleaseVersion = isPrereleaseVersion;
exports.resolveUpdateChannel = resolveUpdateChannel;
exports.resolveDesktopReleaseChannelContract = resolveDesktopReleaseChannelContract;
exports.evaluateUpdateCheck = evaluateUpdateCheck;
exports.evaluateUpdateCandidate = evaluateUpdateCandidate;
const rollbackPolicy_1 = require("./rollbackPolicy");
function isPrereleaseVersion(version) {
    const value = String(version || '').trim();
    if (!value)
        return false;
    return /^\d+\.\d+\.\d+-.+/.test(value);
}
function inferUpdateChannel(appVersion) {
    return isPrereleaseVersion(appVersion || '') ? 'prerelease' : 'stable';
}
function resolveUpdateChannel(input) {
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
function resolveDesktopReleaseChannelContract(input) {
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
function evaluateUpdateCheck(input) {
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
        const rollbackDecision = (0, rollbackPolicy_1.evaluateRollbackCurrentVersion)({
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
function evaluateUpdateCandidate(input) {
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
        const rollbackDecision = (0, rollbackPolicy_1.evaluateRollbackCandidate)({
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
