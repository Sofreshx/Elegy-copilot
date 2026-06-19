import assert from 'node:assert/strict';
import test from 'node:test';

import { buildKimakiArgs, createKimakiCli } from './kimakiCli';

test('builds pinned-entrypoint Kimaki arguments with the data directory', () => {
  assert.deepEqual(
    buildKimakiArgs('C:\\app\\node_modules\\kimaki\\bin.js', 'C:\\Users\\test\\.elegy\\kimaki', [
      'project',
      'list',
      '--json',
    ]),
    [
      'C:\\app\\node_modules\\kimaki\\bin.js',
      'project',
      'list',
      '--json',
      '--data-dir',
      'C:\\Users\\test\\.elegy\\kimaki',
    ],
  );
});

test('lists sessions for an explicit project directory', async () => {
  let capturedArgs: string[] = [];
  const cli = createKimakiCli({
    nodeExecutable: 'node.exe',
    kimakiEntrypoint: 'kimaki\\bin.js',
    dataDir: 'C:\\Users\\test\\.elegy\\kimaki',
    execFileImpl: ((
      _file: string,
      args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      capturedArgs = [...args];
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
    '--data-dir',
    'C:\\Users\\test\\.elegy\\kimaki',
  ]);
});
