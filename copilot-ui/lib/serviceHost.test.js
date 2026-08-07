'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createServiceHost, SERVICE_IDS } = require('./serviceHost');

function createHost(overrides = {}) {
  const calls = [];
  let started = false;
  const execFile = async (command, args, options) => {
    calls.push({ kind: 'exec', command, args, options });
    if (args.some((arg) => String(arg).endsWith('start-overseer.ps1'))) {
      started = true;
      return { stdout: JSON.stringify({ status: 'ready', reason_code: 'health_ready' }), stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('start-local.ps1'))) {
      return { stdout: JSON.stringify({ status: 'ready', schema: 'owm.local.database-status.v1' }), stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('status-overseer.ps1'))) {
      return { stdout: JSON.stringify(started ? { status: 'ready', reason_code: 'health_ready' } : { status: 'stopped', reason_code: 'no_state' }), stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('status-local.ps1'))) {
      return { stdout: JSON.stringify({ status: 'stopped', schema: 'owm.local.database-status.v1' }), stderr: '' };
    }
    return { stdout: JSON.stringify({ status: 'stopped' }), stderr: '' };
  };
  const spawn = (command, args, options) => {
    calls.push({ kind: 'spawn', command, args, options });
    if (args.some((arg) => String(arg).endsWith('start-overseer.ps1'))) started = true;
    return { once() {}, unref() {} };
  };

  const host = createServiceHost({
    engineRoot: 'C:/Users/test/GitHub/instruction-engine',
    repositoryPaths: {
      overseer: 'C:/Users/test/GitHub/Overseer',
      'opportunity-world-model': 'C:/Users/test/GitHub/opportunity-world-model',
    },
    directoryExists: () => true,
    fileExists: (candidate) => candidate.endsWith('package.json') || candidate.endsWith('Cargo.toml') || candidate.endsWith('.ps1'),
    readFile: (candidate) => candidate.endsWith('Cargo.toml') ? '[workspace]' : JSON.stringify({ name: 'overseer-knowledge-base' }),
    execFile,
    spawn,
    request: async () => ({ status: 200, json: async () => ({ format: 'overseer.health/v1', snapshot_status: 'coherent', status: 'ok' }) }),
    ...overrides,
  });

  return { host, calls };
}

test('exposes only the two fixed intelligence service descriptors', () => {
  const { host } = createHost();
  assert.deepEqual(SERVICE_IDS, ['overseer', 'opportunity-world-model']);
  assert.deepEqual(host.listDescriptors().map((item) => item.id), SERVICE_IDS);
  assert.equal(host.getDescriptor('overseer').consoleUrl, 'http://127.0.0.1:4173/dashboard/?embed=elegy#/work-brain');
  assert.equal(host.getDescriptor('opportunity-world-model').healthUrl, 'http://127.0.0.1:7400/healthz');
  assert.equal(host.getDescriptor('opportunity-world-model').name, 'Opportunity Intelligence Engine');
  assert.equal(host.getDescriptor('opportunity-world-model').consoleUrl, 'http://127.0.0.1:7400/?embed=elegy&view=oie');
});

test('inspect reports stopped service without exposing repository paths', async () => {
  const { host } = createHost();
  const result = await host.inspect('overseer');
  assert.equal(result.status, 'stopped');
  assert.equal(result.reasonCode, 'no_state');
  assert.equal('repositoryPath' in result, false);
  assert.equal(result.consoleUrl.includes('embed=elegy'), true);
});

test('start requires a fixed service id and executes only the source-owned script', async () => {
  const { host, calls } = createHost({
    request: async () => ({ status: 200, json: async () => ({ format: 'overseer.health/v1', snapshot_status: 'coherent' }) }),
  });
  const result = await host.start('overseer');
  assert.equal(result.status, 'ready');
  const startCall = calls.find((call) => call.kind === 'spawn' && call.args.some((arg) => String(arg).endsWith('start-overseer.ps1')));
  assert.ok(startCall);
  assert.equal(startCall.command, 'pwsh');
  assert.equal(startCall.args.includes('-NoBrowser'), true);
  assert.equal(startCall.options.stdio, 'ignore');
  await assert.rejects(() => host.start('../secrets'), /unknown_service/);
});

test('missing repository is reported as a prerequisite instead of being executed', async () => {
  const { host } = createHost({
    directoryExists: () => false,
    fileExists: () => false,
  });
  const result = await host.inspect('overseer');
  assert.equal(result.status, 'prerequisite_missing');
  assert.equal(result.reasonCode, 'repository_missing');
});

test('rejects an unapproved repository path or mismatched repository identity', async () => {
  const substituted = createHost({
    repositoryPaths: { overseer: 'C:/Users/test/GitHub/not-overseer' },
  });
  const pathResult = await substituted.host.inspect('overseer');
  assert.equal(pathResult.status, 'prerequisite_missing');
  assert.equal(pathResult.reasonCode, 'repository_path_unapproved');

  const mismatched = createHost({
    readFile: () => JSON.stringify({ name: 'not-overseer' }),
  });
  const identityResult = await mismatched.host.inspect('overseer');
  assert.equal(identityResult.status, 'prerequisite_missing');
  assert.equal(identityResult.reasonCode, 'repository_identity_mismatch');
});

test('reports a starting state while the fixed start script is still running', async () => {
  let ready = false;
  const { host } = createHost({
    spawn: () => ({ once() {}, unref() {} }),
    execFile: async (command, args) => {
      if (args.some((arg) => String(arg).endsWith('status-overseer.ps1'))) {
        return { stdout: JSON.stringify(ready ? { status: 'ready', reason_code: 'health_ready' } : { status: 'stopped', reason_code: 'no_state' }), stderr: '' };
      }
      return { stdout: JSON.stringify({ status: 'stopped' }), stderr: '' };
    },
  });
  const startPromise = host.start('overseer');
  await new Promise((resolve) => setImmediate(resolve));
  const interim = await host.inspect('overseer');
  assert.equal(interim.status, 'starting');
  assert.equal(interim.reasonCode, 'operation_in_progress');
  ready = true;
  const result = await startPromise;
  assert.equal(result.status, 'ready');
});

test('accepts only the latest inspected state as an action confirmation', async () => {
  let tick = 0;
  const { host } = createHost({ now: () => new Date(++tick) });
  const first = await host.inspect('overseer');
  assert.equal(await host.assertFreshConfirmation('overseer', 'start', first.checkedAt), true);
  await host.inspect('overseer');
  await assert.rejects(
    () => host.assertFreshConfirmation('overseer', 'start', first.checkedAt),
    (error) => error && error.code === 'confirmation_stale',
  );
});
