'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { register } = require('../routes/assets');
const { readCatalogAuditEvents } = require('../lib/catalogAuditAnalytics');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}

function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2) + '\n');
}

function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text);
}

function invokeSyncAllRoute(engineRoot, copilotHomeAbs, body) {
  return new Promise((resolve, reject) => {
    const routes = register({
      engineRoot,
      readJsonBody: async () => body,
      sendJson: (_res, status, payload) => resolve({ status, payload }),
    });

    const route = routes.find((entry) => entry.method === 'POST' && entry.path === '/api/assets/sync-all');
    if (!route) {
      reject(new Error('POST /api/assets/sync-all route not registered'));
      return;
    }

    route.handler({ req: {}, res: {}, copilotHomeAbs });
  });
}

async function run() {
  console.log('\nAssets Sync Missing Source Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-assets-sync-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const copilotHomeAbs = path.join(tmpRoot, '.copilot');

  try {
    writeJson(path.join(engineRoot, 'engine-assets', 'manifest.json'), {
      assets: [
        {
          id: 'skill-valid',
          type: 'skill',
          source: 'engine-assets/skills/valid-skill',
          destination: 'skills/valid-skill',
          loadMode: 'always',
        },
        {
          id: 'skill-missing',
          type: 'skill',
          source: 'engine-assets/skills/missing-skill',
          destination: 'skills/missing-skill',
          loadMode: 'on-demand',
        },
      ],
    });
    writeText(path.join(engineRoot, 'engine-assets', 'skills', 'valid-skill', 'SKILL.md'), '# Valid Skill\n');
    fs.mkdirSync(copilotHomeAbs, { recursive: true });

    await test('sync-all skips unreadable sources instead of failing the whole batch', async () => {
      const response = await invokeSyncAllRoute(engineRoot, copilotHomeAbs, {
        dryRun: false,
        force: false,
        pointerMode: true,
      });

      assert.strictEqual(response.status, 200);
      assert.ok(response.payload && typeof response.payload === 'object');
      assert.ok(Array.isArray(response.payload.result));
      assert.deepStrictEqual(
        response.payload.result.map((entry) => entry.id),
        ['skill-valid']
      );
      assert.ok(!('error' in response.payload), 'Expected no route error payload');

      const installedSkill = path.join(copilotHomeAbs, 'skills', 'valid-skill', 'SKILL.md');
      const vaultedSkill = path.join(copilotHomeAbs, 'skills-vault', 'valid-skill', 'SKILL.md');
      assert.ok(fs.existsSync(installedSkill), 'Expected valid skill to install to skills/');
      assert.ok(fs.existsSync(vaultedSkill), 'Expected valid skill to copy to skills-vault/');

      const auditEvents = readCatalogAuditEvents(copilotHomeAbs, 10);
      assert.ok(
        auditEvents.some((event) => event.eventType === 'asset.installed' && event.assetId === 'skill-valid'),
        'Expected canonical asset.installed audit event for managed sync',
      );
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
