'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDocsRepairService, isEligibleIssue } = require('./docsRepairService');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

function fixtureIssue(code, overrides = {}) {
  return {
    code,
    severity: overrides.severity ?? 'error',
    file: overrides.file ?? `docs/${code}.md`,
    line: overrides.line ?? 12,
    message: overrides.message ?? `${code} message`,
    suggestion: overrides.suggestion ?? 'Fix deterministically.',
  };
}

function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function tick() {
      try {
        const value = predicate();
        if (value) {
          resolve(value);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 10);
    }
    tick();
  });
}

function createTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docs-repair-test-'));
}

async function run() {
  console.log('\nDocs Repair Service Tests\n');

  await test('eligibility is limited to safe docs-only issue codes with file and line', async () => {
    assert.equal(isEligibleIssue(fixtureIssue('broken_internal_link')), true);
    assert.equal(isEligibleIssue(fixtureIssue('frontmatter_invalid')), true);
    assert.equal(isEligibleIssue(fixtureIssue('missing_dependency')), true);
    assert.equal(isEligibleIssue(fixtureIssue('stale_doc')), false);
    assert.equal(isEligibleIssue(fixtureIssue('broken_internal_link', { line: 0 })), false);
    assert.equal(isEligibleIssue(fixtureIssue('broken_internal_link', { file: 'package.json' })), false);
  });

  await test('service batches only eligible issue codes and enforces concurrency limit', async () => {
    const elegyHome = createTempHome();
    const held = new Promise(() => {});
    const service = createDocsRepairService(
      { elegyHome, engineRoot: path.resolve(__dirname, '..', '..'), concurrencyLimit: 3 },
      {
        detectOpenCodeBin: () => 'opencode',
        runCommand(command) {
          if (command === 'opencode') return held;
          return Promise.resolve({ stdout: '{}', stderr: '', status: 0 });
        },
      },
    );
    const issues = [
      fixtureIssue('broken_internal_link'),
      fixtureIssue('stale_doc'),
      fixtureIssue('frontmatter_invalid', { file: 'docs/front.md' }),
    ];

    const first = await service.startRepair({ repoPath: elegyHome, issues, batchSize: 20 });
    assert.equal(first.run.issues.length, 2);
    assert.deepEqual(first.run.issueSummary.byCode, {
      broken_internal_link: 1,
      frontmatter_invalid: 1,
    });

    await service.startRepair({ repoPath: elegyHome, issues, batchSize: 20 });
    await service.startRepair({ repoPath: elegyHome, issues, batchSize: 20 });
    await assert.rejects(
      () => service.startRepair({ repoPath: elegyHome, issues, batchSize: 20 }),
      /concurrency limit/i,
    );
  });

  await test('service rejects invalid batch sizes and requests without eligible issues', async () => {
    const elegyHome = createTempHome();
    const service = createDocsRepairService(
      { elegyHome, engineRoot: path.resolve(__dirname, '..', '..') },
      { detectOpenCodeBin: () => 'opencode' },
    );

    await assert.rejects(
      () => service.startRepair({ repoPath: elegyHome, issues: [fixtureIssue('broken_internal_link')], batchSize: 10 }),
      /batchSize must be 20 or 50/i,
    );
    await assert.rejects(
      () => service.startRepair({ repoPath: elegyHome, issues: [fixtureIssue('stale_doc')], batchSize: 20 }),
      /No eligible docs repair issues/i,
    );
  });

  await test('successful run validates, commits, pushes, and opens a draft PR', async () => {
    const elegyHome = createTempHome();
    const calls = [];
    const service = createDocsRepairService(
      { elegyHome, engineRoot: path.resolve(__dirname, '..', '..'), concurrencyLimit: 3 },
      {
        detectOpenCodeBin: () => 'opencode',
        runCommand(command, args) {
          calls.push({ command, args });
          if (command === 'node') {
            return Promise.resolve({ stdout: JSON.stringify({ score: 100, issues: [], severityCounts: { error: 0, warning: 0, info: 0 } }), stderr: '', status: 0 });
          }
          if (command === 'git' && args.includes('status')) {
            return Promise.resolve({ stdout: ' M docs/a.md\n', stderr: '', status: 0 });
          }
          if (command === 'git' && args.includes('rev-parse')) {
            return Promise.resolve({ stdout: 'abc123\n', stderr: '', status: 0 });
          }
          if (command === 'gh' && args.includes('view')) {
            return Promise.resolve({ stdout: JSON.stringify({ url: 'https://github.com/example/repo/pull/1' }), stderr: '', status: 0 });
          }
          return Promise.resolve({ stdout: '', stderr: '', status: 0 });
        },
      },
    );

    const created = await service.startRepair({
      repoPath: elegyHome,
      issues: [fixtureIssue('broken_internal_link')],
      batchSize: 20,
    });
    const completed = await waitFor(() => {
      const run = service.getRun(created.run.id, elegyHome);
      return run && run.status === 'succeeded' ? run : null;
    });

    assert.equal(completed.commitSha, 'abc123');
    assert.equal(completed.prUrl, 'https://github.com/example/repo/pull/1');
    assert.ok(calls.some((call) => call.command === 'opencode'));
    assert.ok(calls.some((call) => call.command === 'git' && call.args.includes('commit')));
    assert.ok(calls.some((call) => call.command === 'git' && call.args.includes('push')));
    assert.ok(calls.some((call) => call.command === 'gh' && call.args.includes('--draft')));
    const prCreate = calls.find((call) => call.command === 'gh' && call.args.includes('create'));
    assert.ok(prCreate.args.includes('--body'));
    const prBody = prCreate.args[prCreate.args.indexOf('--body') + 1];
    assert.match(prBody, /Selected issues: 1/);
    assert.match(prBody, /Fixed selected issues: 1/);
    assert.match(prBody, /Validation score: 100/);
  });

  await test('validation failure leaves the run failed without push or PR', async () => {
    const elegyHome = createTempHome();
    const calls = [];
    const issue = fixtureIssue('broken_internal_link');
    const service = createDocsRepairService(
      { elegyHome, engineRoot: path.resolve(__dirname, '..', '..') },
      {
        detectOpenCodeBin: () => 'opencode',
        runCommand(command, args) {
          calls.push({ command, args });
          if (command === 'node') {
            return Promise.resolve({ stdout: JSON.stringify({ score: 80, issues: [issue], severityCounts: { error: 1, warning: 0, info: 0 } }), stderr: '', status: 1 });
          }
          return Promise.resolve({ stdout: '', stderr: '', status: 0 });
        },
      },
    );

    const created = await service.startRepair({ repoPath: elegyHome, issues: [issue], batchSize: 20 });
    const failed = await waitFor(() => {
      const run = service.getRun(created.run.id, elegyHome);
      return run && run.status === 'failed' ? run : null;
    });

    assert.match(failed.error, /no selected eligible issues/i);
    assert.ok(failed.worktreePath);
    assert.ok(failed.logs.some((entry) => /Validated repair output/.test(entry.message)));
    assert.ok(failed.logs.some((entry) => /Repair run failed/.test(entry.message)));
    assert.ok(calls.every((call) => !(call.command === 'git' && call.args.includes('push'))));
    assert.ok(calls.every((call) => call.command !== 'gh'));
  });

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((error) => {
  console.error('Unexpected error:', error);
  process.exitCode = 1;
});
