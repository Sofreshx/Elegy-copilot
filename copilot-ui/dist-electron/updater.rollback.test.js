"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const updater_1 = require("./updater");
class FakeUpdater {
    constructor() {
        this.autoDownload = true;
        this.allowPrerelease = false;
        this.handlers = {};
        this.checkForUpdatesCalls = 0;
    }
    on(event, listener) {
        this.handlers[event] = this.handlers[event] || [];
        this.handlers[event].push(listener);
    }
    async checkForUpdatesAndNotify() {
        this.checkForUpdatesCalls += 1;
    }
    emit(event, payload) {
        const listeners = this.handlers[event] || [];
        for (const listener of listeners) {
            listener(payload);
        }
    }
}
(0, node_test_1.default)('updater fails closed when rollback policy data is unavailable', async () => {
    const fakeUpdater = new FakeUpdater();
    const logs = [];
    const updater = (0, updater_1.configureUpdater)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        updaterClient: fakeUpdater,
        logger: (message) => logs.push(message),
    });
    await updater.checkForUpdates();
    strict_1.default.strictEqual(fakeUpdater.checkForUpdatesCalls, 0);
    strict_1.default.ok(logs.some((entry) => entry.includes('rollback_policy_source_unavailable')));
});
(0, node_test_1.default)('global disable-updates override blocks update checks', async () => {
    const fakeUpdater = new FakeUpdater();
    const logs = [];
    const updater = (0, updater_1.configureUpdater)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        rollbackPolicyJson: '{"updatesEnabled":true}',
        disableUpdates: 'true',
        updaterClient: fakeUpdater,
        logger: (message) => logs.push(message),
    });
    await updater.checkForUpdates();
    strict_1.default.strictEqual(fakeUpdater.checkForUpdatesCalls, 0);
    strict_1.default.ok(logs.some((entry) => entry.includes('updates_disabled_globally')));
});
(0, node_test_1.default)('updater enforces rollback candidate ceiling when checks are enabled', () => {
    const fakeUpdater = new FakeUpdater();
    const logs = [];
    (0, updater_1.configureUpdater)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        rollbackPolicyJson: JSON.stringify({
            updatesEnabled: true,
            minimumSafeVersion: '1.2.0',
            channelVersionCeilings: {
                stable: '1.2.4',
            },
        }),
        updaterClient: fakeUpdater,
        logger: (message) => logs.push(message),
    });
    fakeUpdater.emit('update-available', { version: '1.2.5' });
    fakeUpdater.emit('update-available', { version: '1.2.4' });
    strict_1.default.ok(logs.some((entry) => entry.includes('candidate_version_above_channel_ceiling')));
    strict_1.default.ok(logs.some((entry) => entry.includes('update available on channel stable: 1.2.4')));
});
