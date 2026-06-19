import assert from 'node:assert/strict';
import test from 'node:test';

import { buildKimakiArgs, buildKimakiCliEnv, createKimakiCli } from './kimakiCli';

test('builds pinned-entrypoint Kimaki subcommand arguments without unsupported data-dir flag', () => {
  assert.deepEqual(
    buildKimakiArgs('C:\\app\\node_modules\\kimaki\\bin.js', [
      'project',
      'list',
      '--json',
    ]),
    [
      'C:\\app\\node_modules\\kimaki\\bin.js',
      'project',
      'list',
      '--json',
    ],
  );
});

test('points Kimaki subcommands at the managed database through the environment', () => {
  assert.equal(
    buildKimakiCliEnv('C:\\Users\\test\\.elegy\\kimaki', {
      KIMAKI_DB_AUTH_TOKEN: 'remove-me',
      EXISTING: 'preserved',
    }).KIMAKI_DB_URL,
    'file:C:\\Users\\test\\.elegy\\kimaki\\discord-sessions.db',
  );
  assert.equal(buildKimakiCliEnv('C:\\data', { EXISTING: 'preserved' }).EXISTING, 'preserved');
  assert.equal(buildKimakiCliEnv('C:\\data', { KIMAKI_DB_AUTH_TOKEN: 'remove-me' }).KIMAKI_DB_AUTH_TOKEN, undefined);
});

test('lists sessions for an explicit project directory', async () => {
  let capturedArgs: string[] = [];
  let capturedOptions: { env?: NodeJS.ProcessEnv } = {};
  const cli = createKimakiCli({
    nodeExecutable: 'node.exe',
    kimakiEntrypoint: 'kimaki\\bin.js',
    dataDir: 'C:\\Users\\test\\.elegy\\kimaki',
    execFileImpl: ((
      _file: string,
      args: readonly string[],
      execOptions: { env?: NodeJS.ProcessEnv },
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      capturedArgs = [...args];
      capturedOptions = execOptions;
      callback(null, '[]', '');
    }) as never,
  });

  await cli.sessionList('C:\\repo');

  assert.deepEqual(capturedArgs, [
    'kimaki\\bin.js',
    'session',
    'list',
    '--project',
    'C:\\repo',
    '--json',
  ]);
  assert.equal(
    capturedOptions.env?.KIMAKI_DB_URL,
    'file:C:\\Users\\test\\.elegy\\kimaki\\discord-sessions.db',
  );
});

test('project add and prompt send use the same environment contract', async () => {
  const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const cli = createKimakiCli({
    nodeExecutable: 'node.exe',
    kimakiEntrypoint: 'kimaki\\bin.js',
    dataDir: 'C:\\Users\\test\\.elegy\\kimaki',
    execFileImpl: ((
      _file: string,
      args: readonly string[],
      options: { env?: NodeJS.ProcessEnv },
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      calls.push({ args: [...args], env: options.env });
      callback(null, '', '');
    }) as never,
  });

  await cli.projectAdd('C:\\repo', 'guild-1');
  await cli.send({ project: 'C:\\repo', prompt: 'Fix tests' });

  assert.deepEqual(calls[0].args, ['kimaki\\bin.js', 'project', 'add', 'C:\\repo', '--guild', 'guild-1']);
  assert.deepEqual(calls[1].args, ['kimaki\\bin.js', 'send', '--project', 'C:\\repo', '--prompt', 'Fix tests']);
  assert.ok(calls.every((call) => call.env?.KIMAKI_DB_URL?.endsWith('discord-sessions.db')));
});
