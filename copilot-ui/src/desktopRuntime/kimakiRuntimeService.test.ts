import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createKimakiRuntimeService } from './kimakiRuntimeService';

test('tracks Kimaki onboarding and ready states', async () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => {
    child.emit('exit', 0, null);
    return true;
  };

  const service = createKimakiRuntimeService({
    elegyHome: 'C:\\Users\\test\\.elegy',
    nodeExecutable: 'node.exe',
    kimakiEntrypoint: 'kimaki\\bin.js',
    spawnImpl: (() => child) as never,
  });

  service.start();
  stdout.emit('data', Buffer.from('data: {"type":"install_url","url":"https://example.test"}\n\n'));
  assert.equal(service.getState(), 'awaiting_install');
  stdout.emit('data', Buffer.from('data: {"type":"authorized","guild_id":"guild-1"}\n\n'));
  assert.equal(service.getState(), 'awaiting_auth');
  stdout.emit('data', Buffer.from('data: {"type":"ready","app_id":"app-1","guild_ids":["guild-1"]}\n\n'));
  assert.equal(service.getState(), 'ready');
  assert.deepEqual(service.getGuildIds(), ['guild-1']);

  await service.stop();
  assert.equal(service.getState(), 'idle');
});

test('reuses the onboarding callback when restarted', async () => {
  const spawnedArgs: string[][] = [];
  const children: Array<EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  }> = [];
  const spawnImpl = ((_executable: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.emit('exit', 0, null);
      return true;
    };
    spawnedArgs.push(args);
    children.push(child);
    return child;
  }) as never;
  const service = createKimakiRuntimeService({
    elegyHome: 'C:\\Users\\test\\.elegy',
    nodeExecutable: 'node.exe',
    kimakiEntrypoint: 'kimaki\\bin.js',
    spawnImpl,
  });

  service.start({ callbackUrl: 'http://127.0.0.1:3210/?remote-onboarding=complete' });
  await service.restart();

  assert.equal(children.length, 2);
  assert.deepEqual(spawnedArgs[1], spawnedArgs[0]);
  await service.stop();
});

test('does not spawn a replacement when the current process fails to stop', async () => {
  let spawnCount = 0;
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  const service = createKimakiRuntimeService({
    elegyHome: 'C:\\Users\\test\\.elegy',
    nodeExecutable: 'node.exe',
    kimakiEntrypoint: 'kimaki\\bin.js',
    stopTimeoutMs: 5,
    spawnImpl: (() => {
      spawnCount += 1;
      return child;
    }) as never,
  });

  service.start();
  await assert.rejects(() => service.restart(), /shutdown timeout/);
  assert.equal(spawnCount, 1);
});
