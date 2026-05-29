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
    'example-external-provider',
    'plugins',
    'external-provider',
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

function invokeInstallSurfaces(copilotHomeAbs, vscodeHomeAbs, body, extraDeps = {}) {
  return new Promise((resolve, reject) => {
    const routes = register({
      readJsonBody: () => Promise.resolve(body),
      sendJson: (_res, status, payload) => resolve({ status, payload }),
      ...extraDeps,
    });

    const route = routes.find((entry) => entry.method === 'POST' && entry.path === '/api/assets/install-surfaces');
    if (!route) {
      reject(new Error('POST /api/assets/install-surfaces route not registered'));
      return;
    }

    route.handler({ req: {}, res: {}, copilotHomeAbs, vscodeHomeAbs });
  });
}

async function run() {
  console.log('\nAssets Routes Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-assets-routes-'));
  const copilotHomeAbs = path.join(tmpRoot, '.copilot');

  try {
    writeText(
      path.join(copilotHomeAbs, 'skills', 'external-provider', 'brainstorming', 'SKILL.md'),
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
    writeText(
      path.join(copilotHomeAbs, 'skills', 'providers', 'external-provider', 'workflow-kit', 'SKILL.md'),
      '# Workflow Kit\n',
    );
    writeText(
      path.join(copilotHomeAbs, 'skills', 'operations', 'release-drill', 'index.md'),
      '# Release Drill\n',
    );
    writeText(
      path.join(copilotHomeAbs, 'skills-vault', 'on-demand-skill', 'SKILL.md'),
      '# On Demand Skill\n',
    );
    writeText(
      path.join(copilotHomeAbs, 'skills-vault', 'providers', 'external-provider', 'incident-kit', 'index.md'),
      '# Incident Kit\n',
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
    writeText(
      path.join(copilotHomeAbs, 'agents', 'providers--external--workflow-guide.md'),
      [
        '---',
        'name: workflow-guide',
        'description: Managed-import workflow guide.',
        'model: inherit',
        '---',
        '',
        '# Workflow Guide',
        '',
        'Managed import workflow guide.',
        '',
      ].join('\n'),
    );

    await test('installed inventory includes plugin-style skills and plain markdown agents', async () => {
      const response = await invokeInstalled(copilotHomeAbs);
      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.payload.skills), 'expected skills array');
      assert.ok(Array.isArray(response.payload.agents), 'expected agents array');

      const pluginSkill = response.payload.skills.find(
        (skill) => skill.viewPath === 'skills/external-provider/brainstorming/SKILL.md'
      );
      assert.ok(pluginSkill, 'expected plugin skill in installed inventory');
      assert.strictEqual(pluginSkill.viewPath, 'skills/external-provider/brainstorming/SKILL.md');
      assert.strictEqual(pluginSkill.readOnly, true);
      assert.strictEqual(pluginSkill.provider, 'copilot-home-plugin');

      const importedSkill = response.payload.skills.find((skill) => skill.viewPath === 'skills/providers/external-provider/workflow-kit/SKILL.md');
      assert.ok(importedSkill, 'expected managed-import provider skill in installed inventory');
      assert.strictEqual(importedSkill.provider, 'copilot-home-plugin');
      assert.strictEqual(importedSkill.readOnly, true);

      const namespacedIndexSkill = response.payload.skills.find((skill) => skill.viewPath === 'skills/operations/release-drill/index.md');
      assert.ok(namespacedIndexSkill, 'expected namespaced index.md skill in installed inventory');
      assert.strictEqual(namespacedIndexSkill.namespace, 'operations');
      assert.strictEqual(namespacedIndexSkill.provider, 'copilot-home-plugin');
      assert.strictEqual(namespacedIndexSkill.readOnly, true);

      const vaultOnlySkill = response.payload.skills.find((skill) => skill.name === 'on-demand-skill');
      assert.ok(vaultOnlySkill, 'expected vault-only skill in installed inventory');
      assert.strictEqual(vaultOnlySkill.kind, 'vault');
      assert.strictEqual(vaultOnlySkill.viewPath, 'skills-vault/on-demand-skill/SKILL.md');

      const vaultedProviderIndexSkill = response.payload.skills.find(
        (skill) => skill.viewPath === 'skills-vault/providers/external-provider/incident-kit/index.md'
      );
      assert.ok(vaultedProviderIndexSkill, 'expected vault provider index.md skill in installed inventory');
      assert.strictEqual(vaultedProviderIndexSkill.provider, 'copilot-home-plugin');
      assert.strictEqual(vaultedProviderIndexSkill.readOnly, true);

      const pluginAgent = response.payload.agents.find((agent) => agent.fileName === 'code-reviewer.md');
      assert.ok(pluginAgent, 'expected plain markdown plugin agent in installed inventory');
      assert.strictEqual(pluginAgent.readOnly, true);
      if (pluginAgentInstall.linked) {
        assert.strictEqual(pluginAgent.provider, 'copilot-marketplace-plugin');
        assert.strictEqual(pluginAgent.namespace, 'external-provider');
        assert.strictEqual(pluginAgent.sourcePackage, 'example-external-provider');
      } else {
        assert.strictEqual(pluginAgent.provider, 'copilot-home-plain-agent');
      }

      const importedAgent = response.payload.agents.find((agent) => agent.fileName === 'providers--external--workflow-guide.md');
      assert.ok(importedAgent, 'expected managed-import provider agent in installed inventory');
      assert.strictEqual(importedAgent.provider, 'copilot-home-plugin');
      assert.strictEqual(importedAgent.readOnly, true);
    });

    await test('delete route rejects plugin namespace roots and plain markdown agents', async () => {
      const namespaceDelete = await invokeDelete(copilotHomeAbs, {
        path: 'skills/external-provider',
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
      let pointerProbeAttempted = false;
      let readAttempted = false;
      const response = await invokeView(copilotHomeAbs, 'agents/code-reviewer.md', {
        fs: {
          existsSync: () => true,
          realpathSync: () => path.join(tmpRoot, 'outside', 'secret.md'),
        },
        assets: {
          isPointerFile: () => {
            pointerProbeAttempted = true;
            return false;
          },
          readTextFileSafe: () => {
            readAttempted = true;
            return 'unexpected';
          },
        },
      });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.mode, 'json');
      assert.match(String(response.payload.error || ''), /escapes supported copilot roots/i);
      assert.strictEqual(pointerProbeAttempted, false);
      assert.strictEqual(readAttempted, false);
    });

    await test('delete route canonicalizes flat skill file paths to the whole skill root', async () => {
      const flatSkillRoot = path.join(copilotHomeAbs, 'skills', 'flat-skill');
      writeText(path.join(flatSkillRoot, 'SKILL.md'), '# Flat Skill\n');
      writeText(path.join(flatSkillRoot, 'notes.txt'), 'extra content');

      const response = await invokeDelete(copilotHomeAbs, {
        path: 'skills/flat-skill/SKILL.md',
        force: true,
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.payload.deleted, 'skills/flat-skill');
      assert.strictEqual(fs.existsSync(flatSkillRoot), false);
    });

    await test('asset view accepts Windows-only casing differences for in-root real paths', async () => {
      if (process.platform !== 'win32') {
        return;
      }

      const lowerHome = copilotHomeAbs.toLowerCase();
      const response = await invokeView(lowerHome, 'agents/code-reviewer.md', {
        fs: {
          existsSync: () => true,
          realpathSync: () => path.join(copilotHomeAbs.toUpperCase(), 'agents', 'code-reviewer.md'),
        },
        assets: {
          isPointerFile: () => false,
          readTextFileSafe: () => '# Agent',
        },
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.mode, 'text');
      assert.strictEqual(response.payload, '# Agent');
    });

    await test('install-surfaces forwards target to the backend helper', async () => {
      const vscodeHomeAbs = path.join(tmpRoot, '.vscode-copilot');
      let receivedOptions = null;

      const response = await invokeInstallSurfaces(
        copilotHomeAbs,
        vscodeHomeAbs,
        { target: 'all', force: true },
        {
          engineRoot: tmpRoot,
          installSurfaces: async (options) => {
            receivedOptions = options;
            return { target: options.target, surfaces: [{ surface: 'codex', ok: true }] };
          },
          assets: {
            syncAll: () => [],
          },
        },
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.payload.target, 'all');
      assert.ok(receivedOptions, 'expected route to call installSurfaces helper');
      assert.strictEqual(receivedOptions.target, 'all');
      assert.strictEqual(receivedOptions.force, true);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(receivedOptions, 'copilotHomeAbs'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(receivedOptions, 'vscodeHomeAbs'), false);
    });

    await test('install-surfaces forwards the opencode target to the backend helper', async () => {
      let receivedOptions = null;

      const response = await invokeInstallSurfaces(
        copilotHomeAbs,
        path.join(tmpRoot, '.vscode-copilot'),
        { target: 'opencode', force: false },
        {
          engineRoot: tmpRoot,
          installSurfaces: async (options) => {
            receivedOptions = options;
            return { target: options.target, surfaces: [{ surface: 'opencode', ok: true }] };
          },
          assets: {
            syncAll: () => [],
          },
        },
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.payload.target, 'opencode');
      assert.ok(receivedOptions, 'expected route to call installSurfaces helper');
      assert.strictEqual(receivedOptions.target, 'opencode');
      assert.strictEqual(receivedOptions.force, false);
    });

    await test('install-surfaces rejects requests without a target', async () => {
      const response = await invokeInstallSurfaces(
        copilotHomeAbs,
        path.join(tmpRoot, '.vscode-copilot'),
        {},
        {
          engineRoot: tmpRoot,
          assets: {
            syncAll: () => [],
          },
        },
      );

      assert.strictEqual(response.status, 400);
      assert.match(String(response.payload.error || ''), /target is required/i);
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
