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
        this.downloadUpdateCalls = 0;
        this.quitAndInstallCalls = 0;
    }
    on(event, listener) {
        this.handlers[event] = this.handlers[event] || [];
        this.handlers[event].push(listener);
    }
    async checkForUpdates() {
        this.checkForUpdatesCalls += 1;
    }
    async checkForUpdatesAndNotify() {
        this.checkForUpdatesCalls += 1;
    }
    async downloadUpdate() {
        this.downloadUpdateCalls += 1;
    }
    quitAndInstall() {
        this.quitAndInstallCalls += 1;
    }
    emit(event, payload) {
        const listeners = this.handlers[event] || [];
        for (const listener of listeners) {
            listener(payload);
        }
    }
}
(0, node_test_1.default)('updater publishes available, downloading, and downloaded states', async () => {
    const fakeUpdater = new FakeUpdater();
    const updater = (0, updater_1.configureUpdater)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        rollbackPolicyJson: JSON.stringify({ updatesEnabled: true, minimumSafeVersion: '1.2.0' }),
        updaterClient: fakeUpdater,
    });
    await updater.checkForUpdates();
    fakeUpdater.emit('update-available', { version: '1.2.4' });
    strict_1.default.equal(updater.getState().status, 'available');
    strict_1.default.equal(updater.getState().availableVersion, '1.2.4');
    await updater.downloadUpdate();
    fakeUpdater.emit('download-progress', { percent: 64, transferred: 64, total: 100 });
    strict_1.default.equal(updater.getState().status, 'downloading');
    strict_1.default.equal(updater.getState().progressPercent, 64);
    fakeUpdater.emit('update-downloaded', { version: '1.2.4' });
    strict_1.default.equal(updater.getState().status, 'downloaded');
    strict_1.default.equal(updater.getState().canRestartToUpdate, true);
    const restarted = await updater.restartToUpdate();
    strict_1.default.equal(restarted, true);
    strict_1.default.equal(fakeUpdater.quitAndInstallCalls, 1);
});
(0, node_test_1.default)('updater surfaces up-to-date state from update-not-available', () => {
    const fakeUpdater = new FakeUpdater();
    const updater = (0, updater_1.configureUpdater)({
        appVersion: '1.2.3',
        explicitChannel: 'stable',
        rollbackPolicyJson: JSON.stringify({ updatesEnabled: true, minimumSafeVersion: '1.2.0' }),
        updaterClient: fakeUpdater,
    });
    fakeUpdater.emit('update-not-available', { version: '1.2.3' });
    strict_1.default.equal(updater.getState().status, 'up-to-date');
    strict_1.default.match(updater.getState().message || '', /up to date/i);
});
