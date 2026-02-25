"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPrereleaseVersion = isPrereleaseVersion;
exports.resolveUpdateChannel = resolveUpdateChannel;
exports.evaluateUpdateCheck = evaluateUpdateCheck;
exports.evaluateUpdateCandidate = evaluateUpdateCandidate;
const rollbackPolicy_1 = require("./rollbackPolicy");
function isPrereleaseVersion(version) {
    const value = String(version || '').trim();
    if (!value)
        return false;
    return /^\d+\.\d+\.\d+-.+/.test(value);
}
function resolveUpdateChannel(input) {
    const explicit = String(input.explicitChannel || '').trim().toLowerCase();
    if (explicit === 'stable')
        return 'stable';
    if (explicit === 'prerelease')
        return 'prerelease';
    return isPrereleaseVersion(input.appVersion || '') ? 'prerelease' : 'stable';
}
function evaluateUpdateCheck(input) {
    const channel = resolveUpdateChannel(input);
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
