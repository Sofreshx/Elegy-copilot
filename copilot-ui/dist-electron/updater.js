"use strict";
/// <reference path="./electron-externals.d.ts" />
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureUpdater = configureUpdater;
const electron_updater_1 = require("electron-updater");
const rollbackPolicy_1 = require("./rollbackPolicy");
const updatePolicy_1 = require("./updatePolicy");
function parseBooleanOverride(input) {
    if (typeof input === 'boolean') {
        return input;
    }
    const value = String(input || '').trim().toLowerCase();
    if (!value) {
        return null;
    }
    if (value === '1' || value === 'true' || value === 'yes' || value === 'on') {
        return true;
    }
    if (value === '0' || value === 'false' || value === 'no' || value === 'off') {
        return false;
    }
    return null;
}
function resolveEffectiveRollbackPolicy(options) {
    const disableOverride = parseBooleanOverride(options.disableUpdates);
    const disableOverrideIsMalformed = options.disableUpdates !== undefined && options.disableUpdates !== null && disableOverride === null;
    if (disableOverrideIsMalformed) {
        return {
            ok: false,
            reason: 'rollback_policy_malformed',
        };
    }
    if (disableOverride === true) {
        return {
            ok: true,
            policy: {
                updatesEnabled: false,
            },
        };
    }
    const parsedPolicy = (0, rollbackPolicy_1.resolveRollbackPolicy)(options.rollbackPolicyJson);
    if (!parsedPolicy.ok) {
        return parsedPolicy;
    }
    if (disableOverride === false) {
        return {
            ok: true,
            policy: {
                ...parsedPolicy.policy,
                updatesEnabled: true,
            },
        };
    }
    return parsedPolicy;
}
function configureUpdater(options) {
    const logger = options.logger || (() => { });
    const updater = (options.updaterClient || electron_updater_1.autoUpdater);
    const channel = (0, updatePolicy_1.resolveUpdateChannel)({
        appVersion: options.appVersion,
        explicitChannel: options.explicitChannel,
    });
    const rollbackPolicy = resolveEffectiveRollbackPolicy(options);
    const checkDecision = (0, updatePolicy_1.evaluateUpdateCheck)({
        appVersion: options.appVersion,
        explicitChannel: options.explicitChannel,
        rollbackPolicy,
    });
    updater.autoDownload = false;
    updater.allowPrerelease = channel === 'prerelease';
    if (!checkDecision.allowed) {
        logger(`[updater] update checks blocked on channel ${channel}: ${checkDecision.reason}`);
    }
    updater.on('update-available', (info) => {
        if (!checkDecision.allowed) {
            return;
        }
        const details = info && typeof info === 'object' ? info : {};
        const candidateVersion = String(details.version || '').trim();
        const decision = (0, updatePolicy_1.evaluateUpdateCandidate)({
            appVersion: options.appVersion,
            explicitChannel: options.explicitChannel,
            candidateVersion,
            rollbackPolicy,
        });
        if (!decision.allowed) {
            logger(`[updater] blocked update candidate ${candidateVersion || '(unknown)'} on channel ${decision.channel}: ${decision.reason}`);
            return;
        }
        logger(`[updater] update available on channel ${decision.channel}: ${candidateVersion || '(unknown)'}`);
    });
    updater.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger(`[updater] error: ${message}`);
    });
    return {
        channel,
        checkForUpdates: async () => {
            if (!checkDecision.allowed) {
                return;
            }
            await updater.checkForUpdatesAndNotify();
        },
    };
}
