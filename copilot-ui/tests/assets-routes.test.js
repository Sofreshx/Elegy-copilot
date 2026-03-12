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

function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
}

function installPluginAgent(copilotHomeAbs, text) {
  const pluginAgentAbs = path.join(
    copilotHomeAbs,
    'marketplace-cache',
    'dwaintr-superpowers-copilot',
    'plugins',
    'superpowers',
    'agents',
    'code-reviewer.md',
  );
  writeText(pluginAgentAbs, text);

  const linkedAgentAbs = path.join(copilotHomeAbs, 'agents', 'code-reviewer.md');
  fs.mkdirSync(path.dirname(linkedAgentAbs), { recursive: true });
  try {
    fs.symlinkSync(pluginAgentAbs, linkedAgentAbs, 'file');
    return { linked: true, linkedAgentAbs, pluginAgentAbs };
  } catch {
    writeText(linkedAgentAbs, text);
    return { linked: false, linkedAgentAbs, pluginAgentAbs };
  }
}

function invokeInstalled(copilotHomeAbs) {
  return new Promise((resolve, reject) => {
    const routes = register({
      sendJson: (_res, status, payload) => resolve({ status, payload }),
    });

    const route = routes.find((entry) => entry.method === 'GET' && entry.path === '/api/assets/installed');
    if (!route) {
      reject(new Error('GET /api/assets/installed route not registered'));
      return;
    }

    route.handler({ req: {}, res: {}, copilotHomeAbs });
  });
}

function invokeDelete(copilotHomeAbs, body) {
  return new Promise((resolve, reject) => {
    const routes = register({
      readJsonBody: () => Promise.resolve(body),
      sendJson: (_res, status, payload) => resolve({ status, payload }),
    });

    const route = routes.find((entry) => entry.method === 'POST' && entry.path === '/api/assets/delete');
    if (!route) {
      reject(new Error('POST /api/assets/delete route not registered'));
      return;
    }

    route.handler({ req: {}, res: {}, copilotHomeAbs });
  });
}

function invokeView(copilotHomeAbs, relPath, extraDeps = {}) {
  return new Promise((resolve, reject) => {
    const routes = register({
      sendJson: (_res, status, payload) => resolve({ status, payload, mode: 'json' }),
      sendText: (_res, status, payload) => resolve({ status, payload, mode: 'text' }),
      ...extraDeps,
    });

    const route = routes.find((entry) => entry.method === 'GET' && entry.path === '/api/assets/view');
    if (!route) {
      reject(new Error('GET /api/assets/view route not registered'));
      return;
    }

    route.handler({
      req: {},
      res: {},
      copilotHomeAbs,
      u: new URL(`http://localhost/api/assets/view?path=${encodeURIComponent(relPath)}`),
    });
  });
}

async function run() {
  console.log('\nAssets Routes Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-assets-routes-'));
  const copilotHomeAbs = path.join(tmpRoot, '.copilot');

  try {
    writeText(
      path.join(copilotHomeAbs, 'skills', 'superpowers', 'brainstorming', 'SKILL.md'),
      [
        '---',
        'name: brainstorming',
        'description: External brainstorming workflow.',
        '---',
        '# Brainstorming',
        '',
        'Plugin-installed brainstorming workflow.',
        '',
      ].join('\n'),
    );
    const pluginAgentInstall = installPluginAgent(
      copilotHomeAbs,
      [
        '---',
        'name: code-reviewer',
        'description: External review agent.',
        'model: inherit',
        '---',
        '',
        '# Code Reviewer',
        '',
        'Plugin-installed review guidance.',
        '',
      ].join('\n'),
    );

    await test('installed inventory includes plugin-style skills and plain markdown agents', async () => {
      const response = await invokeInstalled(copilotHomeAbs);
      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.payload.skills), 'expected skills array');
      assert.ok(Array.isArray(response.payload.agents), 'expected agents array');

      const pluginSkill = response.payload.skills.find((skill) => skill.namespace === 'superpowers');
      assert.ok(pluginSkill, 'expected plugin skill in installed inventory');
      assert.strictEqual(pluginSkill.viewPath, 'skills/superpowers/brainstorming/SKILL.md');
      assert.strictEqual(pluginSkill.readOnly, true);

      const pluginAgent = response.payload.agents.find((agent) => agent.fileName === 'code-reviewer.md');
      assert.ok(pluginAgent, 'expected plain markdown plugin agent in installed inventory');
      assert.strictEqual(pluginAgent.readOnly, true);
      if (pluginAgentInstall.linked) {
        assert.strictEqual(pluginAgent.namespace, 'superpowers');
        assert.strictEqual(pluginAgent.sourcePackage, 'dwaintr-superpowers-copilot');
      }
    });

    await test('delete route rejects plugin namespace roots and plain markdown agents', async () => {
      const namespaceDelete = await invokeDelete(copilotHomeAbs, {
        path: 'skills/superpowers',
        force: true,
      });
      assert.strictEqual(namespaceDelete.status, 400);
      assert.match(String(namespaceDelete.payload.error || ''), /unsupported skill namespace roots/i);

      const pluginAgentDelete = await invokeDelete(copilotHomeAbs, {
        path: 'agents/code-reviewer.md',
        force: true,
      });
      assert.strictEqual(pluginAgentDelete.status, 400);
      assert.match(String(pluginAgentDelete.payload.error || ''), /expected \*\.agent\.md/i);
    });

    await test('asset view rejects symlink targets that escape the copilot home root', async () => {
      let readAttempted = false;
      const response = await invokeView(copilotHomeAbs, 'agents/code-reviewer.md', {
        fs: {
          existsSync: () => true,
          realpathSync: () => path.join(tmpRoot, 'outside', 'secret.md'),
        },
        assets: {
          isPointerFile: () => false,
          readTextFileSafe: () => {
            readAttempted = true;
            return 'unexpected';
          },
        },
      });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.mode, 'json');
      assert.match(String(response.payload.error || ''), /escapes supported copilot roots/i);
      assert.strictEqual(readAttempted, false);
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
