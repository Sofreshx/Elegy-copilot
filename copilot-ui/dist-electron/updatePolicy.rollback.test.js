"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const rollbackPolicy_1 = require("./rollbackPolicy");
const updatePolicy_1 = require("./updatePolicy");
(0, node_test_1.default)('channel policy remains backward compatible when rollback policy is omitted', () => {
    const decision = (0, updatePolicy_1.evaluateUpdateCandidate)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        candidateVersion: '1.2.4',
    });
    strict_1.default.deepStrictEqual(decision, {
        channel: 'stable',
        allowed: true,
        reason: 'allowed_by_channel_policy',
    });
});
(0, node_test_1.default)('stable channel still blocks prerelease candidates before rollback checks', () => {
    const policy = (0, rollbackPolicy_1.resolveRollbackPolicy)('{"updatesEnabled":true}');
    const decision = (0, updatePolicy_1.evaluateUpdateCandidate)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        candidateVersion: '1.2.4-rc.1',
        rollbackPolicy: policy,
    });
    strict_1.default.deepStrictEqual(decision, {
        channel: 'stable',
        allowed: false,
        reason: 'stable_channel_blocks_prerelease_candidate',
    });
});
(0, node_test_1.default)('rollback policy blocks update checks and candidates with machine-readable reasons', () => {
    const policy = (0, rollbackPolicy_1.resolveRollbackPolicy)('{"updatesEnabled":false}');
    const checkDecision = (0, updatePolicy_1.evaluateUpdateCheck)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        rollbackPolicy: policy,
    });
    strict_1.default.deepStrictEqual(checkDecision, {
        channel: 'stable',
        allowed: false,
        reason: 'updates_disabled_globally',
    });
    const candidateDecision = (0, updatePolicy_1.evaluateUpdateCandidate)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        candidateVersion: '1.2.4',
        rollbackPolicy: policy,
    });
    strict_1.default.deepStrictEqual(candidateDecision, {
        channel: 'stable',
        allowed: false,
        reason: 'updates_disabled_globally',
    });
});
(0, node_test_1.default)('rollback policy fail-closed reason propagates through update decision logic', () => {
    const unavailablePolicy = (0, rollbackPolicy_1.resolveRollbackPolicy)('');
    const decision = (0, updatePolicy_1.evaluateUpdateCheck)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        rollbackPolicy: unavailablePolicy,
    });
    strict_1.default.deepStrictEqual(decision, {
        channel: 'stable',
        allowed: false,
        reason: 'rollback_policy_source_unavailable',
    });
});
