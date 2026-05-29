'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { register } = require('../routes/assets');

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

function invokeSkillsPreview(engineRoot, copilotHomeAbs) {
  return new Promise((resolve, reject) => {
    const routes = register({
      engineRoot,
      sendJson: (_res, status, payload) => resolve({ status, payload }),
    });

    const route = routes.find((entry) => entry.method === 'GET' && entry.path === '/api/skills/preview');
    if (!route) {
      reject(new Error('GET /api/skills/preview route not registered'));
      return;
    }

    route.handler({ req: {}, res: {}, copilotHomeAbs });
  });
}

async function run() {
  console.log('\nSkills Preview Catalog Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-skills-preview-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const copilotHomeAbs = path.join(tmpRoot, '.copilot');

  try {
    writeJson(path.join(engineRoot, 'engine-assets', 'manifest.json'), {
      assets: [
        {
          id: 'skill-core-guardrails',
          type: 'skill',
          source: 'engine-assets/skills/core-guardrails',
          destination: 'skills/core-guardrails',
          loadMode: 'always',
        },
        {
          id: 'skill-wolverine-core',
          type: 'skill',
          source: 'engine-assets/skills/wolverine-core',
          destination: 'skills/wolverine-core',
          loadMode: 'on-demand',
        },
        {
          id: 'skill-missing-skill',
          type: 'skill',
          source: 'engine-assets/skills/missing-skill',
          destination: 'skills/missing-skill',
          loadMode: 'on-demand',
        },
      ],
      sourcePatterns: [],
    });

    writeJson(path.join(engineRoot, 'engine-assets', 'skills', 'skill-metadata-index.json'), {
      schemaVersion: 1,
      entries: [
        {
          skill: 'core-guardrails',
          name: 'core-guardrails',
          description: 'Always-loaded safety rules.',
          triggersOn: ['safety', 'terminal'],
          aliasKeys: ['terminal-safety'],
          frameworks: ['node'],
          languages: ['javascript'],
          tags: ['safety'],
          manifest: { id: 'skill-core-guardrails', loadMode: 'always' },
        },
        {
          skill: 'wolverine-core',
          name: 'wolverine-core',
          description: 'On-demand Wolverine guidance.',
          triggersOn: ['wolverine', 'message handler'],
          aliasKeys: ['message dispatcher'],
          frameworks: ['dotnet'],
          languages: ['csharp'],
          tags: ['messaging'],
          manifest: { id: 'skill-wolverine-core', loadMode: 'on-demand' },
        },
        {
          skill: 'missing-skill',
          name: 'missing-skill',
          description: 'Managed but not installed yet.',
          triggersOn: ['missing'],
          aliasKeys: ['preview placeholder'],
          frameworks: ['node'],
          languages: ['javascript'],
          tags: ['missing'],
          manifest: { id: 'skill-missing-skill', loadMode: 'on-demand' },
        },
      ],
    });

    writeText(path.join(copilotHomeAbs, 'skills', 'core-guardrails', 'SKILL.md'), '# Core Guardrails\n');
    writeText(path.join(copilotHomeAbs, 'skills-vault', 'core-guardrails', 'SKILL.md'), '# Core Guardrails Vault\n');
    writeText(path.join(copilotHomeAbs, 'skills-vault', 'wolverine-core', 'SKILL.md'), '# Wolverine Core\n');
    writeText(
      path.join(copilotHomeAbs, 'skills', 'external-provider', 'brainstorming', 'SKILL.md'),
      [
        '---',
        'name: brainstorming',
        'description: External brainstorming workflow.',
        '---',
        '# Brainstorming',
        '',
        'Plugin-installed brainstorming guidance.',
        '',
      ].join('\n'),
    );

    await test('preview returns always-loaded, vault-only, and managed-missing skills', async () => {
      const response = await invokeSkillsPreview(engineRoot, copilotHomeAbs);

      assert.strictEqual(response.status, 200);
      assert.ok(response.payload && Array.isArray(response.payload.skills));

      const byName = new Map(response.payload.skills.map((skill) => [skill.name, skill]));

      assert.ok(byName.has('core-guardrails'), 'expected core-guardrails in preview');
      assert.ok(byName.has('wolverine-core'), 'expected wolverine-core in preview');
      assert.ok(byName.has('missing-skill'), 'expected missing-skill in preview');

      assert.strictEqual(byName.get('core-guardrails').loadMode, 'always');
      assert.strictEqual(byName.get('core-guardrails').kind, 'full');
      assert.strictEqual(byName.get('core-guardrails').availability, 'scan+vault');
      assert.strictEqual(byName.get('core-guardrails').viewPath, 'skills/core-guardrails/SKILL.md');

      assert.strictEqual(byName.get('wolverine-core').loadMode, 'on-demand');
      assert.strictEqual(byName.get('wolverine-core').kind, 'vault');
      assert.strictEqual(byName.get('wolverine-core').availability, 'vault-only');
      assert.strictEqual(byName.get('wolverine-core').viewPath, 'skills-vault/wolverine-core/SKILL.md');

      assert.strictEqual(byName.get('missing-skill').kind, 'missing');
      assert.strictEqual(byName.get('missing-skill').availability, 'not-installed');
      assert.strictEqual(byName.get('missing-skill').loadMode, 'on-demand');
      assert.strictEqual(byName.get('missing-skill').triggers, 'missing');
    });

    await test('preview keeps plugin-installed skills distinct with explicit view paths and read-only provenance', async () => {
      writeText(path.join(copilotHomeAbs, 'skills', 'brainstorming', 'SKILL.md'), '# Brainstorming Local\n');

      const response = await invokeSkillsPreview(engineRoot, copilotHomeAbs);
      assert.strictEqual(response.status, 200);

      const brainstormingItems = response.payload.skills.filter((skill) => skill.name === 'brainstorming');
      assert.strictEqual(brainstormingItems.length, 2, 'expected flat and plugin brainstorming entries');

      const pluginEntry = brainstormingItems.find((skill) => skill.namespace === 'external-provider');
      const flatEntry = brainstormingItems.find((skill) => !skill.namespace);

      assert.ok(pluginEntry, 'expected plugin brainstorming entry');
      assert.ok(flatEntry, 'expected flat brainstorming entry');
      assert.notStrictEqual(pluginEntry.assetId, flatEntry.assetId);
      assert.strictEqual(pluginEntry.viewPath, 'skills/external-provider/brainstorming/SKILL.md');
      assert.strictEqual(pluginEntry.readOnly, true);
      assert.ok(
        ['external-provider', 'copilot-home-plugin', 'copilot-marketplace-plugin'].includes(pluginEntry.provider),
        `unexpected plugin provider: ${pluginEntry.provider}`,
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
