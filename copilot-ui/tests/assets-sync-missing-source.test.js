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

    await test('sync-all prunes missing-source manifest assets from disk and install state', async () => {
      const staleStatePath = path.join(copilotHomeAbs, '.instruction-engine-install-state.json');
      writeText(path.join(copilotHomeAbs, 'skills', 'missing-skill', 'SKILL.md'), '# Missing Skill\n');
      writeText(path.join(copilotHomeAbs, 'skills-vault', 'missing-skill', 'SKILL.md'), '# Missing Skill Vault\n');
      writeJson(staleStatePath, {
        schemaVersion: 3,
        installProfile: 'copilot-ui',
        managedSkills: ['missing-skill'],
        alwaysLoadedSkills: [],
        vaultSkills: ['missing-skill'],
        managedAgents: [],
        managedPrompts: [],
      });

      const response = await invokeSyncAllRoute(engineRoot, copilotHomeAbs, {
        dryRun: false,
        force: true,
        pointerMode: true,
      });

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(
        response.payload.result.map((entry) => entry.id),
        ['skill-valid']
      );
      assert.ok(!fs.existsSync(path.join(copilotHomeAbs, 'skills', 'missing-skill')), 'Expected missing-source skill install to be pruned');
      assert.ok(!fs.existsSync(path.join(copilotHomeAbs, 'skills-vault', 'missing-skill')), 'Expected missing-source skill vault entry to be pruned');

      const nextState = JSON.parse(fs.readFileSync(staleStatePath, 'utf8'));
      assert.deepStrictEqual(nextState.managedSkills, ['valid-skill']);
      assert.deepStrictEqual(nextState.alwaysLoadedSkills, ['valid-skill']);
      assert.deepStrictEqual(nextState.vaultSkills, ['valid-skill']);
    });

    await test('sync-all prunes stale managed assets recorded in the prior install state', async () => {
      const staleStatePath = path.join(copilotHomeAbs, '.instruction-engine-install-state.json');
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
            id: 'agent-current',
            type: 'agent',
            source: 'engine-assets/agents/current.agent.md',
            destination: 'agents/current.agent.md',
          },
          {
            id: 'prompt-current',
            type: 'prompt',
            source: 'engine-assets/prompts/current.prompt.md',
            destination: 'prompts/current.prompt.md',
          },
        ],
      });
      writeText(path.join(engineRoot, 'engine-assets', 'agents', 'current.agent.md'), '# Current Agent\n');
      writeText(path.join(engineRoot, 'engine-assets', 'prompts', 'current.prompt.md'), '# Current Prompt\n');

      writeText(path.join(copilotHomeAbs, 'skills', 'stale-skill', 'SKILL.md'), '# Stale Skill\n');
      writeText(path.join(copilotHomeAbs, 'skills-vault', 'stale-skill', 'SKILL.md'), '# Stale Skill Vault\n');
      writeText(path.join(copilotHomeAbs, 'agents', 'stale.agent.md'), '# Stale Agent\n');
      writeText(path.join(copilotHomeAbs, 'prompts', 'stale.prompt.md'), '# Stale Prompt\n');
      writeJson(staleStatePath, {
        schemaVersion: 3,
        installProfile: 'minimal',
        managedSkills: ['stale-skill'],
        alwaysLoadedSkills: ['stale-skill'],
        vaultSkills: ['stale-skill'],
        managedAgents: ['stale.agent.md'],
        managedPrompts: ['stale.prompt.md'],
      });

      const response = await invokeSyncAllRoute(engineRoot, copilotHomeAbs, {
        dryRun: false,
        force: true,
        pointerMode: true,
      });

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(
        response.payload.result.map((entry) => entry.id),
        ['skill-valid', 'agent-current', 'prompt-current']
      );
      assert.ok(!fs.existsSync(path.join(copilotHomeAbs, 'skills', 'stale-skill')), 'Expected stale skill install to be pruned');
      assert.ok(!fs.existsSync(path.join(copilotHomeAbs, 'skills-vault', 'stale-skill')), 'Expected stale skill vault entry to be pruned');
      assert.ok(!fs.existsSync(path.join(copilotHomeAbs, 'agents', 'stale.agent.md')), 'Expected stale agent to be pruned');
      assert.ok(!fs.existsSync(path.join(copilotHomeAbs, 'prompts', 'stale.prompt.md')), 'Expected stale prompt to be pruned');

      const nextState = JSON.parse(fs.readFileSync(staleStatePath, 'utf8'));
      assert.deepStrictEqual(nextState.managedSkills, ['valid-skill']);
      assert.deepStrictEqual(nextState.alwaysLoadedSkills, ['valid-skill']);
      assert.deepStrictEqual(nextState.vaultSkills, ['valid-skill']);
      assert.deepStrictEqual(nextState.managedAgents, ['current.agent.md']);
      assert.deepStrictEqual(nextState.managedPrompts, ['current.prompt.md']);
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
