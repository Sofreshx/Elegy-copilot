"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const rollbackPolicy_1 = require("./rollbackPolicy");
(0, node_test_1.default)('resolveRollbackPolicy fails closed when source is unavailable', () => {
    const policy = (0, rollbackPolicy_1.resolveRollbackPolicy)(null);
    strict_1.default.deepStrictEqual(policy, {
        ok: false,
        reason: 'rollback_policy_source_unavailable',
    });
    const decision = (0, rollbackPolicy_1.evaluateRollbackCurrentVersion)({
        channel: 'stable',
        currentVersion: '1.2.3',
        rollbackPolicy: policy,
    });
    strict_1.default.deepStrictEqual(decision, {
        allowed: false,
        reason: 'rollback_policy_source_unavailable',
    });
});
(0, node_test_1.default)('resolveRollbackPolicy rejects malformed input', () => {
    const malformed = (0, rollbackPolicy_1.resolveRollbackPolicy)('{"updatesEnabled":"yes"}');
    strict_1.default.deepStrictEqual(malformed, {
        ok: false,
        reason: 'rollback_policy_malformed',
    });
});
(0, node_test_1.default)('global updates disabled blocks current and candidates', () => {
    const policy = (0, rollbackPolicy_1.resolveRollbackPolicy)('{"updatesEnabled":false}');
    strict_1.default.equal(policy.ok, true);
    const currentDecision = (0, rollbackPolicy_1.evaluateRollbackCurrentVersion)({
        channel: 'stable',
        currentVersion: '1.2.3',
        rollbackPolicy: policy,
    });
    strict_1.default.strictEqual(currentDecision.reason, 'updates_disabled_globally');
    const candidateDecision = (0, rollbackPolicy_1.evaluateRollbackCandidate)({
        channel: 'stable',
        currentVersion: '1.2.3',
        candidateVersion: '1.2.4',
        rollbackPolicy: policy,
    });
    strict_1.default.strictEqual(candidateDecision.reason, 'updates_disabled_globally');
});
(0, node_test_1.default)('minimum safe threshold and channel ceiling enforce rollback guardrails', () => {
    const policy = (0, rollbackPolicy_1.resolveRollbackPolicy)(JSON.stringify({
        updatesEnabled: true,
        minimumSafeVersion: '1.2.3',
        channelVersionCeilings: {
            stable: '1.2.5',
        },
    }));
    strict_1.default.equal(policy.ok, true);
    const unsafeCurrent = (0, rollbackPolicy_1.evaluateRollbackCurrentVersion)({
        channel: 'stable',
        currentVersion: '1.2.2',
        rollbackPolicy: policy,
    });
    strict_1.default.strictEqual(unsafeCurrent.reason, 'current_version_below_minimum_safe');
    const unsafeCandidate = (0, rollbackPolicy_1.evaluateRollbackCandidate)({
        channel: 'stable',
        currentVersion: '1.2.3',
        candidateVersion: '1.2.2',
        rollbackPolicy: policy,
    });
    strict_1.default.strictEqual(unsafeCandidate.reason, 'candidate_version_below_minimum_safe');
    const aboveCeiling = (0, rollbackPolicy_1.evaluateRollbackCandidate)({
        channel: 'stable',
        currentVersion: '1.2.3',
        candidateVersion: '1.2.6',
        rollbackPolicy: policy,
    });
    strict_1.default.strictEqual(aboveCeiling.reason, 'candidate_version_above_channel_ceiling');
    const allowed = (0, rollbackPolicy_1.evaluateRollbackCandidate)({
        channel: 'stable',
        currentVersion: '1.2.3',
        candidateVersion: '1.2.5',
        rollbackPolicy: policy,
    });
    strict_1.default.deepStrictEqual(allowed, {
        allowed: true,
        reason: 'allowed_by_rollback_policy',
    });
});
