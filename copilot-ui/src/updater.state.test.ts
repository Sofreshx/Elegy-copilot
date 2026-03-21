import assert from 'node:assert/strict';
import test from 'node:test';

import { configureUpdater } from './updater';

class FakeUpdater {
  autoDownload = true;
  allowPrerelease = false;
  private readonly handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  checkForUpdatesCalls = 0;
  downloadUpdateCalls = 0;
  quitAndInstallCalls = 0;

  on(event: string, listener: (...args: unknown[]) => void) {
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

  emit(event: string, payload?: unknown) {
    const listeners = this.handlers[event] || [];
    for (const listener of listeners) {
      listener(payload);
    }
  }
}

test('updater publishes available, downloading, and downloaded states', async () => {
  const fakeUpdater = new FakeUpdater();
  const updater = configureUpdater({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    rollbackPolicyJson: JSON.stringify({ updatesEnabled: true, minimumSafeVersion: '1.2.0' }),
    updaterClient: fakeUpdater,
  });

  await updater.checkForUpdates();
  fakeUpdater.emit('update-available', { version: '1.2.4' });
  assert.equal(updater.getState().status, 'available');
  assert.equal(updater.getState().availableVersion, '1.2.4');

  await updater.downloadUpdate();
  fakeUpdater.emit('download-progress', { percent: 64, transferred: 64, total: 100 });
  assert.equal(updater.getState().status, 'downloading');
  assert.equal(updater.getState().progressPercent, 64);

  fakeUpdater.emit('update-downloaded', { version: '1.2.4' });
  assert.equal(updater.getState().status, 'downloaded');
  assert.equal(updater.getState().canRestartToUpdate, true);

  const restarted = await updater.restartToUpdate();
  assert.equal(restarted, true);
  assert.equal(fakeUpdater.quitAndInstallCalls, 1);
});

test('updater surfaces up-to-date state from update-not-available', () => {
  const fakeUpdater = new FakeUpdater();
  const updater = configureUpdater({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    rollbackPolicyJson: JSON.stringify({ updatesEnabled: true, minimumSafeVersion: '1.2.0' }),
    updaterClient: fakeUpdater,
  });

  fakeUpdater.emit('update-not-available', { version: '1.2.3' });
  assert.equal(updater.getState().status, 'up-to-date');
  assert.match(updater.getState().message || '', /up to date/i);
});