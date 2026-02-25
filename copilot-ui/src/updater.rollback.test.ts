import assert from 'node:assert/strict';
import test from 'node:test';

import { configureUpdater } from './updater';

class FakeUpdater {
  autoDownload = true;
  allowPrerelease = false;
  private readonly handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  checkForUpdatesCalls = 0;

  on(event: string, listener: (...args: unknown[]) => void) {
    this.handlers[event] = this.handlers[event] || [];
    this.handlers[event].push(listener);
  }

  async checkForUpdatesAndNotify() {
    this.checkForUpdatesCalls += 1;
  }

  emit(event: string, payload: unknown) {
    const listeners = this.handlers[event] || [];
    for (const listener of listeners) {
      listener(payload);
    }
  }
}

test('updater fails closed when rollback policy data is unavailable', async () => {
  const fakeUpdater = new FakeUpdater();
  const logs: string[] = [];

  const updater = configureUpdater({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    updaterClient: fakeUpdater,
    logger: (message) => logs.push(message),
  });

  await updater.checkForUpdates();

  assert.strictEqual(fakeUpdater.checkForUpdatesCalls, 0);
  assert.ok(logs.some((entry) => entry.includes('rollback_policy_source_unavailable')));
});

test('global disable-updates override blocks update checks', async () => {
  const fakeUpdater = new FakeUpdater();
  const logs: string[] = [];

  const updater = configureUpdater({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    rollbackPolicyJson: '{"updatesEnabled":true}',
    disableUpdates: 'true',
    updaterClient: fakeUpdater,
    logger: (message) => logs.push(message),
  });

  await updater.checkForUpdates();

  assert.strictEqual(fakeUpdater.checkForUpdatesCalls, 0);
  assert.ok(logs.some((entry) => entry.includes('updates_disabled_globally')));
});

test('updater enforces rollback candidate ceiling when checks are enabled', () => {
  const fakeUpdater = new FakeUpdater();
  const logs: string[] = [];

  configureUpdater({
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

  assert.ok(logs.some((entry) => entry.includes('candidate_version_above_channel_ceiling')));
  assert.ok(logs.some((entry) => entry.includes('update available on channel stable: 1.2.4')));
});
