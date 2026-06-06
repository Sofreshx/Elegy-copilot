'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listHarnessSessions } = require('./dashboardHarnessSessions');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-harness-sessions-'));
}

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

async function run() {
  console.log('\nDashboard Harness Session Inventory Tests\n');

  await test('lists Copilot, Codex, and Antigravity sessions and leaves unsupported harnesses explicit', async () => {
    const root = makeTempDir();
    const copilotHome = path.join(root, '.copilot');
    const codexHome = path.join(root, '.codex');
    const opencodeHome = path.join(root, '.config', 'opencode');
    const opencodeDataHome = path.join(root, '.local', 'share', 'opencode');
    const geminiHome = path.join(root, '.gemini');
    const antigravityHome = path.join(geminiHome, 'antigravity');

    writeFile(
      path.join(codexHome, 'session_index.jsonl'),
      [
        JSON.stringify({ id: 'codex-1', thread_name: 'Newest Codex session', updated_at: '2026-05-23T12:00:00.000Z' }),
        JSON.stringify({ id: 'codex-2', thread_name: 'Older Codex session', updated_at: '2026-05-22T10:00:00.000Z' }),
      ].join('\n')
    );
    fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
    writeFile(path.join(antigravityHome, 'conversations', 'ag-1.pb'), 'x');
    writeFile(path.join(antigravityHome, 'conversations', 'ag-2.pb'), 'y');
    fs.mkdirSync(opencodeHome, { recursive: true });
    fs.mkdirSync(opencodeDataHome, { recursive: true });
    fs.mkdirSync(path.join(geminiHome, 'history', 'workspace-a'), { recursive: true });
    writeFile(path.join(geminiHome, 'history', 'workspace-a', '.project_root'), 'C:/workspace-a');

    const inventory = listHarnessSessions({
      copilotHome,
      sandboxesHome: path.join(root, 'sandboxes'),
      codexHome,
      opencodeHome,
      opencodeDataHome,
      antigravityHome,
      geminiHome,
      sessionAggregation: {
        buildUnifiedSessions() {
          return [
            {
              sessionId: 'cp-1',
              objective: 'Copilot active session',
              status: 'active',
              updatedAtMs: Date.UTC(2026, 4, 23, 15, 0, 0),
              startedAtMs: Date.UTC(2026, 4, 23, 14, 0, 0),
              elapsedMs: 3_600_000,
              repoLabel: 'instruction-engine',
              source: 'cli',
            },
          ];
        },
      },
    });

    assert.equal(inventory.totalSessionCount, 5);

    const copilot = inventory.harnesses.find((harness) => harness.harnessId === 'copilot');
    const codex = inventory.harnesses.find((harness) => harness.harnessId === 'codex');
    const opencode = inventory.harnesses.find((harness) => harness.harnessId === 'opencode');
    const antigravity = inventory.harnesses.find((harness) => harness.harnessId === 'antigravity');
    const geminiCli = inventory.harnesses.find((harness) => harness.harnessId === 'gemini-cli');

    assert.equal(copilot.inventoryAvailable, true);
    assert.equal(copilot.sessionCount, 1);
    assert.equal(copilot.sessions[0].title, 'Copilot active session');

    assert.equal(codex.inventoryAvailable, true);
    assert.equal(codex.sessionCount, 2);
    assert.deepEqual(codex.sessions.map((session) => session.sessionId), ['codex-1', 'codex-2']);

    assert.equal(antigravity.inventoryAvailable, true);
    assert.equal(antigravity.sessionCount, 2);
    assert.equal(opencode.inventoryAvailable, false);
    assert.equal(opencode.inventoryReason, 'inventory_missing');
    assert.equal(geminiCli.inventoryAvailable, false);
    assert.equal(geminiCli.inventoryReason, 'inventory_not_supported');
  });

  await test('OpenCode inventory returns sessions from log directory and project state', async () => {
    const root = makeTempDir();
    const opencodeDataHome = path.join(root, 'opencode-data');
    const logDir = path.join(opencodeDataHome, 'log');
    const projectStateDir = path.join(opencodeDataHome, 'project');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(projectStateDir, { recursive: true });

    const logTs = '2026-05-23T12:00:00.000Z';
    const logEpoch = Date.parse(logTs);
    writeFile(
      path.join(logDir, '2026-05-23.log'),
      [
        `[${logTs}] INFO session.id=ses_aaa1 agent=plan providerID=openai modelID=gpt-4o`,
        `[${logTs}] INFO session.id=ses_bbb2 agent=build providerID=anthropic modelID=claude-sonnet-4-5`,
        `[${logTs}] WARN this is not a session line`,
        '',
      ].join('\n')
    );

    writeFile(
      path.join(projectStateDir, 'worktree-c.json'),
      JSON.stringify({ sessions: { ses_aaa1: { updatedAtMs: logEpoch + 1000 } } }, null, 2)
    );

    const inventory = listHarnessSessions({
      copilotHome: path.join(root, '.copilot'),
      sandboxesHome: path.join(root, 'sandboxes'),
      codexHome: path.join(root, '.codex'),
      opencodeHome: path.join(root, '.config', 'opencode'),
      opencodeDataHome,
      antigravityHome: path.join(root, '.gemini', 'antigravity'),
      geminiHome: path.join(root, '.gemini'),
      sessionAggregation: { buildUnifiedSessions() { return []; } },
    });

    const opencode = inventory.harnesses.find((harness) => harness.harnessId === 'opencode');
    assert.equal(opencode.inventoryAvailable, true);
    assert.equal(opencode.sessionCount, 2);
    const ids = opencode.sessions.map((session) => session.sessionId).sort();
    assert.deepEqual(ids, ['ses_aaa1', 'ses_bbb2']);
    const aaa1 = opencode.sessions.find((session) => session.sessionId === 'ses_aaa1');
    assert.equal(aaa1.source, 'opencode');
    assert.equal(aaa1.status, 'unknown');
    assert.equal(typeof aaa1.updatedAtMs, 'number');
    assert.equal(aaa1.updatedAtMs, logEpoch);
  });

  await test('OpenCode inventory reports inventory_read_failed when log read throws', async () => {
    const root = makeTempDir();
    const opencodeDataHome = path.join(root, 'opencode-data');
    fs.mkdirSync(path.join(opencodeDataHome, 'log'), { recursive: true });

    const fakeDirStat = { isDirectory: () => true };
    const inventory = listHarnessSessions({
      copilotHome: path.join(root, '.copilot'),
      sandboxesHome: path.join(root, 'sandboxes'),
      codexHome: path.join(root, '.codex'),
      opencodeHome: path.join(root, '.config', 'opencode'),
      opencodeDataHome,
      antigravityHome: path.join(root, '.gemini', 'antigravity'),
      geminiHome: path.join(root, '.gemini'),
      sessionAggregation: { buildUnifiedSessions() { return []; } },
      fsImpl: {
        readdirSync() {
          throw new Error('simulated EACCES on log dir');
        },
        statSync(targetPath) {
          if (String(targetPath).endsWith(path.join('opencode-data', 'log'))
            || String(targetPath).endsWith('opencode-data')) {
            return fakeDirStat;
          }
          return null;
        },
        existsSync() {
          return true;
        },
        readFileSync() {
          return '';
        },
      },
    });

    const opencode = inventory.harnesses.find((harness) => harness.harnessId === 'opencode');
    assert.equal(opencode.inventoryAvailable, false);
    assert.equal(opencode.inventoryReason, 'inventory_read_failed');
  });

  await test('Codex inventory falls back to session folders when index is missing', async () => {
    const root = makeTempDir();
    const codexHome = path.join(root, '.codex');
    fs.mkdirSync(path.join(codexHome, 'sessions', '2026-05-23'), { recursive: true });
    fs.mkdirSync(path.join(codexHome, 'sessions', '2026-05-22'), { recursive: true });
    fs.mkdirSync(path.join(codexHome, 'sessions', '2026-05-23', 'ses_1111'), { recursive: true });
    fs.mkdirSync(path.join(codexHome, 'sessions', '2026-05-23', 'ses_2222'), { recursive: true });
    fs.mkdirSync(path.join(codexHome, 'sessions', '2026-05-22', 'ses_3333'), { recursive: true });
    writeFile(path.join(codexHome, 'sessions', '2026-05-23', 'ses_1111', 'meta.json'), '{}');
    writeFile(path.join(codexHome, 'sessions', '2026-05-23', 'ses_2222', 'meta.json'), '{}');
    writeFile(path.join(codexHome, 'sessions', '2026-05-22', 'ses_3333', 'meta.json'), '{}');

    const inventory = listHarnessSessions({
      copilotHome: path.join(root, '.copilot'),
      sandboxesHome: path.join(root, 'sandboxes'),
      codexHome,
      opencodeHome: path.join(root, '.config', 'opencode'),
      opencodeDataHome: path.join(root, 'opencode-data'),
      antigravityHome: path.join(root, '.gemini', 'antigravity'),
      geminiHome: path.join(root, '.gemini'),
      sessionAggregation: { buildUnifiedSessions() { return []; } },
    });

    const codex = inventory.harnesses.find((harness) => harness.harnessId === 'codex');
    assert.equal(codex.inventoryAvailable, true);
    assert.equal(codex.sessionCount, 3);
    assert.equal(codex.sessions.every((session) => session.storageKind === 'session-folder'), true);
    const ids = codex.sessions.map((session) => session.sessionId).sort();
    assert.deepEqual(ids, ['ses_1111', 'ses_2222', 'ses_3333']);
  });

  await test('Codex inventory reports inventory_read_failed when index exists but is unreadable', async () => {
    const root = makeTempDir();
    const codexHome = path.join(root, '.codex');
    fs.mkdirSync(codexHome, { recursive: true });
    writeFile(path.join(codexHome, 'session_index.jsonl'), '');

    const fakeDirStat = { isDirectory: () => true };
    const inventory = listHarnessSessions({
      copilotHome: path.join(root, '.copilot'),
      sandboxesHome: path.join(root, 'sandboxes'),
      codexHome,
      opencodeHome: path.join(root, '.config', 'opencode'),
      opencodeDataHome: path.join(root, 'opencode-data'),
      antigravityHome: path.join(root, '.gemini', 'antigravity'),
      geminiHome: path.join(root, '.gemini'),
      sessionAggregation: { buildUnifiedSessions() { return []; } },
      fsImpl: {
        statSync(targetPath) {
          if (String(targetPath).endsWith('session_index.jsonl')) {
            return { isFile: () => true };
          }
          return null;
        },
        readFileSync() {
          throw new Error('simulated EACCES on codex index');
        },
        existsSync() { return true; },
        readdirSync() { return []; },
      },
    });

    const codex = inventory.harnesses.find((harness) => harness.harnessId === 'codex');
    assert.equal(codex.inventoryAvailable, false);
    assert.equal(codex.inventoryReason, 'inventory_read_failed');
  });

  if (!process.exitCode) {
    console.log(`\ndashboard harness session inventory tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('dashboard harness session inventory tests failed');
  console.error(error);
  process.exitCode = 1;
});
