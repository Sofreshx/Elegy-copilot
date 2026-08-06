import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const scripts = ['local-operator-common.ps1', 'start-local.ps1', 'stop-local.ps1', 'status-local.ps1'];

test('Elegy local operator scripts expose a fixed, user-local lifecycle boundary', () => {
  for (const name of scripts) assert.equal(existsSync(path.join(root, 'scripts', name)), true, name);
  const common = readFileSync(path.join(root, 'scripts', 'local-operator-common.ps1'), 'utf8');
  const start = readFileSync(path.join(root, 'scripts', 'start-local.ps1'), 'utf8');
  const stop = readFileSync(path.join(root, 'scripts', 'stop-local.ps1'), 'utf8');
  const status = readFileSync(path.join(root, 'scripts', 'status-local.ps1'), 'utf8');
  assert.match(common, /LOCALAPPDATA/);
  assert.match(common, /Win32_Process/);
  assert.match(common, /repository_fingerprint/);
  assert.match(start, /Start-Process/);
  assert.match(stop, /Stop-Process/);
  assert.match(stop, /refusing to stop/i);
  assert.match(common, /elegy\.local\.operator-status\.v1/);
  assert.doesNotMatch(`${common}\n${start}\n${stop}`, /npm\s+(install|ci)|docker\s+pull/i);
});

test('status operator is safe when no user-local state exists', { skip: process.platform !== 'win32' }, () => {
  const pwsh = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts', 'status-local.ps1'), '-Json'], { cwd: root, encoding: 'utf8' });
  assert.equal(pwsh.status, 0, pwsh.stderr);
  const status = JSON.parse(pwsh.stdout);
  assert.equal(status.schema, 'elegy.local.operator-status.v1');
  assert.equal(status.status, 'stopped');
});
