#!/usr/bin/env node
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTestElegyCliShim, withWorkingDirectory } = require('./test-elegy-cli-shim.js');

let passed = 0;

function shaText(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-install-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

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

async function main() {
  const modulePath = pathToFileURL(path.resolve(__dirname, 'codex-install.mjs')).href;
  const utilsPath = pathToFileURL(path.resolve(__dirname, 'install-surface-utils.mjs')).href;
  const installer = await import(modulePath);
  const { dirHash } = await import(utilsPath);

  await test('manifest installs the composed global instructions rather than the home stub', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'codex-assets', 'manifest.json'), 'utf8'));
    const instructions = manifest.assets.find((asset) => asset.id === 'codex-global-instructions');
    assert.strictEqual(instructions.source, 'catalog-assets/instructions/agent-session-defaults.md');
    assert.strictEqual(instructions.appendix, 'codex-assets/home/AGENTS-appendix.md');
    assert.strictEqual(instructions.destination, 'AGENTS.md');
    assert.deepStrictEqual(
      manifest.assets.filter((asset) => asset.type === 'agent').map((asset) => asset.id),
      [
        'codex-explorer-agent',
        'codex-reviewer-agent',
        'codex-reviewer-strong-agent',
        'codex-worker-agent',
        'codex-test-runner-agent',
        'codex-sweeper-agent',
      ],
    );
    assert.deepStrictEqual(
      manifest.assets.filter((asset) => asset.type === 'skill').map((asset) => asset.id),
      [
        'codex-repo-setup-skill',
        'codex-repo-backed-obsidian-docs-skill',
        'codex-sweeper-cleanup-skill',
        'codex-repo-quality-setup-skill',
        'codex-agents-md-authoring-skill',
        'codex-tdd-skill',
        'codex-goal-session-workflow-skill',
        'codex-evaluate-task-workflow-skill',
      ],
    );
    assert.ok(!manifest.assets.some((asset) => /(?:^|-)planning(?:$|-)|repo-checks|openai|(?:^|-)go(?:$|-)/i.test(asset.id)));
  });

  await test('portable Codex install writes an explicit provenance receipt', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const summary = installer.runInstall({ force: true, skipHooks: true, codexHome });
      const receiptPath = path.join(codexHome, '.elegy-codex-portability.json');
      const marketplaceReceiptPath = path.join(codexHome, 'marketplaces', 'elegy', 'elegy-codex-marketplace.install.json');
      assert.ok(fs.existsSync(receiptPath));
      assert.ok(fs.existsSync(marketplaceReceiptPath));
      assert.ok(fs.existsSync(path.join(codexHome, '.elegy-codex-licenses', 'elegy', 'LICENSE.txt')));
      assert.ok(fs.existsSync(path.join(codexHome, '.elegy-codex-licenses', 'playwright-cli', 'LICENSE.txt')));
      assert.ok(fs.existsSync(path.join(codexHome, '.elegy-codex-licenses', 'playwright-cli', 'NOTICE.txt')));
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.strictEqual(receipt.profile, 'codex-portable/v1');
      assert.ok(receipt.approvedPortable.some((entry) => entry.id === 'context7-cli' && entry.pinnedRef));
      assert.ok(receipt.reviewedLocalFolders.some((entry) => entry.name === 'operate-comfyui' && entry.status === 'broken'));
      assert.strictEqual(summary.portability.receiptPath, receiptPath);
      assert.strictEqual(summary.portability.approvedPortable, 3);
      assert.strictEqual(summary.portability.licenseMaterials, 3);
      assert.strictEqual(summary.portability.marketplaceReceipt.status, 'external-install-required');
      assert.strictEqual(JSON.parse(fs.readFileSync(marketplaceReceiptPath, 'utf8')).status, 'external-install-required');
      const rerun = installer.runInstall({ force: true, skipHooks: true, codexHome });
      assert.strictEqual(rerun.portability.marketplaceReceipt.action, 'skipped');
      assert.strictEqual(rerun.portability.marketplaceReceipt.status, 'external-install-required');
    });
  });

  await test('portable Codex install recognizes only a verified marketplace-service receipt as installed', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const marketplaceReceiptPath = path.join(codexHome, 'marketplaces', 'elegy', 'elegy-codex-marketplace.install.json');
      fs.mkdirSync(path.dirname(marketplaceReceiptPath), { recursive: true });
      fs.writeFileSync(marketplaceReceiptPath, JSON.stringify({
        schemaVersion: 'elegy-codex-marketplace-install/v1',
        marketplaceName: 'elegy',
        archiveSha256: 'a'.repeat(64),
        installedAt: '2026-08-06T00:00:00.000Z',
      }), 'utf8');
      const summary = installer.runInstall({ force: true, skipHooks: true, codexHome });
      assert.strictEqual(summary.portability.marketplaceReceipt.status, 'installed-receipt');
    });
  });

  await test('installer creates lean Codex assets and reruns idempotently', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');

      const firstSummary = installer.runInstall({
        force: true,
        codexHome,
        skillsHome,
      });
      assert.ok(fs.existsSync(path.join(codexHome, 'AGENTS.md')));
      const agentsInstructions = fs.readFileSync(path.join(codexHome, 'AGENTS.md'), 'utf8');
      assert.ok(!agentsInstructions.includes('## Code Mode Batching'));
      assert.ok(agentsInstructions.includes('Direct work: do not delegate unless the user asks'));
      assert.ok(agentsInstructions.includes('Planned work:'));
      assert.match(agentsInstructions, /explicitly\s+marked tasks/);
      assert.match(agentsInstructions, /checks\s+results/i);
      assert.ok(agentsInstructions.includes('## Plan execution'));
      assert.match(agentsInstructions, /Acceptance\s+Criteria/);
      assert.ok(!agentsInstructions.includes('about five meaningful tool'));
      assert.ok(!agentsInstructions.includes('explicitly requests subagents and parallel agent work'));
      assert.ok(!agentsInstructions.includes('Default mode: `governed-automatic`'));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'explorer.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'reviewer.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'reviewer_strong.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'worker.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'test-runner.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'sweeper.toml')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'repo-setup', 'SKILL.md')));
      for (const retainedSkill of [
        'repo-backed-obsidian-docs',
        'sweeper-cleanup',
        'repo-quality-setup',
        'agents-md-authoring',
        'tdd',
        'goal-session-workflow',
        'evaluate-task-workflow',
      ]) {
        assert.ok(fs.existsSync(path.join(skillsHome, retainedSkill, 'SKILL.md')), retainedSkill);
      }
      for (const removedSkill of [
        'skill-discovery',
        'rubberduck-plan-review',
        'implementation-review',
        'implementation-handoff',
        'spec-dev',
        'spec-authoring',
        'spec-review',
        'spec-planning-bridge',
        'commit-check-setup',
        'brainstorming',
      ]) {
        assert.ok(!fs.existsSync(path.join(skillsHome, removedSkill)), removedSkill);
      }
      assert.ok(!fs.existsSync(path.join(codexHome, 'agents', 'code-reviewer.toml')));
      assert.ok(!fs.existsSync(path.join(skillsHome, 'core-guardrails', 'SKILL.md')));
      assert.strictEqual(firstSummary.generatedRoles, 0, 'Codex install should not generate engine role wrappers');
      assert.deepStrictEqual(firstSummary.workflowAutomation, {
        status: 'disabled',
        scheduledTaskCreated: false,
        queueEnabled: false,
        reason: 'release_gates_pending',
        requiredGates: ['manual_v2', 'identity_binding', 'hook_trust', 'scheduled_permissions', 'self_exclusion'],
      });
      const explorerAgent = fs.readFileSync(path.join(codexHome, 'agents', 'explorer.toml'), 'utf8');
      assert.ok(explorerAgent.includes('model = "gpt-5.6-luna"'));
      assert.ok(!explorerAgent.includes('model_reasoning_effort ='));
      assert.doesNotMatch(explorerAgent, /^\[elegy\]$/m);
      assert.ok(explorerAgent.includes('developer_instructions = """'));
      const reviewerAgent = fs.readFileSync(path.join(codexHome, 'agents', 'reviewer.toml'), 'utf8');
      assert.ok(reviewerAgent.includes('model = "gpt-5.6-luna"'));
      assert.ok(reviewerAgent.includes('bounded implementation'));
      assert.ok(!reviewerAgent.includes('complex plans'));
      const strongReviewerAgent = fs.readFileSync(path.join(codexHome, 'agents', 'reviewer_strong.toml'), 'utf8');
      assert.ok(strongReviewerAgent.includes('model = "gpt-5.6-sol"'));
      assert.ok(strongReviewerAgent.includes('model_reasoning_effort = "medium"'));
      assert.ok(strongReviewerAgent.includes('sandbox_mode = "read-only"'));
      assert.ok(strongReviewerAgent.includes('architecture'));
      assert.ok(strongReviewerAgent.includes('security'));
      const workerAgent = fs.readFileSync(path.join(codexHome, 'agents', 'worker.toml'), 'utf8');
      assert.ok(workerAgent.includes('model = "gpt-5.6-luna"'));
      assert.ok(workerAgent.includes('model_reasoning_effort = "max"'));
      assert.ok(workerAgent.includes('Work only within the file or module ownership'));
      assert.match(workerAgent, /Never commit, push, publish, change permissions, or spawn/i);
      assert.doesNotMatch(workerAgent, /commits, pushes[\s\S]*unless the parent explicitly authorizes/i);

      const configToml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      const profileToml = fs.readFileSync(path.join(codexHome, 'instruction_engine_plan_review.config.toml'), 'utf8');
      assert.ok(configToml.includes('[agents]'));
      assert.ok(configToml.includes('enabled = true'));
      assert.ok(configToml.includes('max_concurrent_threads_per_session = 6'));
      assert.ok(!configToml.includes('max_threads ='));
      assert.ok(configToml.includes('default_subagent_model = "gpt-5.6-luna"'));
      assert.ok(configToml.includes('default_subagent_reasoning_effort = "high"'));
      assert.ok(configToml.includes('max_depth = 1'));
      assert.ok(configToml.includes('job_max_runtime_seconds = 1800'));
      assert.doesNotMatch(configToml, /review_model|model_provider|model_providers|deepseek|opencode/i);
      assert.ok(!configToml.includes('[profiles.instruction_engine_plan_review]'));
      assert.ok(profileToml.includes('plan_mode_reasoning_effort = "xhigh"'));
      assert.doesNotMatch(profileToml, /model_provider|model_providers|deepseek|opencode/i);

      const secondSummary = installer.runInstall({
        codexHome,
        skillsHome,
      });
      const secondConfig = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      assert.strictEqual(secondConfig, configToml);
      assert.ok(secondSummary.counts.skipped > 0, 'expected idempotent rerun to skip up-to-date assets');
    });
  });

  await test('installer dry-run resolves explicit homes without creating files', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, 'codex-home');
      const skillsHome = path.join(codexHome, 'skills');

      const summary = installer.runInstall({
        dryRun: true,
        force: true,
        codexHome,
        skillsHome,
      });

      assert.ok(!fs.existsSync(codexHome));
      assert.ok(!fs.existsSync(skillsHome));
      assert.ok(summary.counts.wouldCreate > 0 || summary.counts.wouldUpdate > 0);
    });
  });

  await test('installer merges the managed hook definitions without replacing user hooks', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, 'Codex Home');
      const skillsHome = path.join(codexHome, 'skills');
      fs.mkdirSync(codexHome, { recursive: true });
      const hooksPath = path.join(codexHome, 'hooks.json');
      fs.writeFileSync(hooksPath, `${JSON.stringify({
        description: 'User-managed hooks remain here.',
        hooks: {
          Stop: [{
            hooks: [{ type: 'command', command: 'node "C:\\User Hooks\\stop.mjs"' }],
          }],
        },
        userMetadata: { preserve: true },
      }, null, 2)}\n`);

      const first = installer.runInstall({ force: true, codexHome, skillsHome });
      assert.ok(fs.existsSync(path.join(codexHome, 'hooks', 'elegy-workflow-improvement', 'elegy-codex-hook.mjs')));
      const merged = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      assert.strictEqual(merged.userMetadata.preserve, true);
      assert.ok(merged.hooks.Stop[0].hooks.some((hook) => hook.command === 'node "C:\\User Hooks\\stop.mjs"'));
      const managedStopHandlers = merged.hooks.Stop
        .flatMap((group) => group.hooks)
        .filter((hook) => hook.commandWindows && hook.commandWindows.includes('Codex Home\\hooks\\elegy-workflow-improvement'));
      assert.strictEqual(managedStopHandlers.length, 1);
      assert.strictEqual(first.hooks.valid, true);
      assert.match(first.hooks.trustVerification.command, /^\/hooks$/);
      const firstHooksText = fs.readFileSync(hooksPath, 'utf8');

      installer.runInstall({ codexHome, skillsHome });
      const rerun = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      assert.strictEqual(
        rerun.hooks.Stop.flatMap((group) => group.hooks)
          .filter((hook) => hook.commandWindows && hook.commandWindows.includes('Codex Home\\hooks\\elegy-workflow-improvement')).length,
        1,
      );
      assert.strictEqual(fs.readFileSync(hooksPath, 'utf8'), firstHooksText, 'reinstall must not grow hooks.json');
    });
  });

  await test('hook status is local-only and keeps app-server hooks/list verification pending', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, 'Codex Home');
      const skillsHome = path.join(codexHome, 'skills');
      const parsed = installer.parseArgs(['--hooks-status', '--codex-home', codexHome]);
      assert.strictEqual(parsed.hooksStatus, true);
      const status = installer.runInstall({ hooksStatus: true, codexHome, skillsHome });
      assert.strictEqual(status.hooks.localStatus.method, 'hooks.json');
      assert.deepStrictEqual(status.hooks.discoveryVerification, {
        method: 'hooks/list',
        status: 'pending',
        required: true,
      });
      assert.strictEqual(status.hooks.verified, false);
      assert.strictEqual(typeof status.hooks.runtimeStatus.stateRootExists, 'boolean');
      assert.strictEqual(typeof status.hooks.runtimeStatus.bindingsObserved, 'boolean');
      assert.match(status.hooks.runtimeStatus.note, /hooks\/list.*trust/i);
      assert.ok(!fs.existsSync(codexHome), 'status must not install or modify a hook surface');
    });
  });

  await test('hook dry-run emits a receipt and uninstall removes only exact managed commands', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, 'Codex Home');
      const skillsHome = path.join(codexHome, 'skills');
      const dryRun = installer.runInstall({ dryRun: true, codexHome, skillsHome });
      assert.strictEqual(dryRun.hooks.receipt.action, 'would_create');
      assert.ok(!fs.existsSync(codexHome));

      installer.runInstall({ force: true, codexHome, skillsHome });
      const hooksPath = path.join(codexHome, 'hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      hooks.hooks.SessionEnd.push({ hooks: [{ type: 'command', command: 'node "C:\\User Hooks\\archive.mjs"' }] });
      const managedStop = hooks.hooks.Stop.flatMap((group) => group.hooks)
        .find((hook) => hook.commandWindows && hook.commandWindows.includes('elegy-workflow-improvement'));
      hooks.hooks.Stop.push({
        hooks: [{
          ...managedStop,
          commandWindows: 'node "C:\\User Hooks\\custom-stop.mjs" Stop',
        }],
      });
      fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);

      const removed = installer.runInstall({ uninstallHooks: true, codexHome, skillsHome });
      const after = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      assert.ok(after.hooks.SessionEnd.flatMap((group) => group.hooks)
        .some((hook) => hook.command === 'node "C:\\User Hooks\\archive.mjs"'));
      assert.ok(!after.hooks.Stop.flatMap((group) => group.hooks)
        .some((hook) => hook.commandWindows && hook.commandWindows.includes('elegy-workflow-improvement')));
      assert.ok(after.hooks.Stop.flatMap((group) => group.hooks)
        .some((hook) => hook.commandWindows === 'node "C:\\User Hooks\\custom-stop.mjs" Stop'));
      assert.strictEqual(removed.hooks.action, 'uninstalled');
      assert.ok(!fs.existsSync(path.join(codexHome, 'hooks', 'elegy-workflow-improvement')));
      assert.ok(!fs.existsSync(path.join(codexHome, '.elegy-codex-hooks.json')));
    });
  });

  await test('hook runtime drift fails closed without configuring commands or rewriting its receipt', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, 'Codex Home');
      const skillsHome = path.join(codexHome, 'skills');
      const runtimePath = path.join(codexHome, 'hooks', 'elegy-workflow-improvement');
      fs.mkdirSync(runtimePath, { recursive: true });
      fs.writeFileSync(path.join(runtimePath, 'elegy-codex-hook.mjs'), 'user-modified runtime', 'utf8');

      const result = installer.runInstall({ codexHome, skillsHome });

      assert.strictEqual(result.hooks.enabled, false);
      assert.strictEqual(result.hooks.action, 'skipped_conflict');
      assert.ok(!fs.existsSync(path.join(codexHome, 'hooks.json')));
      assert.ok(!fs.existsSync(path.join(codexHome, '.elegy-codex-hooks.json')));
      assert.strictEqual(fs.readFileSync(path.join(runtimePath, 'elegy-codex-hook.mjs'), 'utf8'), 'user-modified runtime');
    });
  });

  await test('hook runtime drift after installation preserves existing hook config and receipt byte-for-byte', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, 'Codex Home');
      const skillsHome = path.join(codexHome, 'skills');
      installer.runInstall({ force: true, codexHome, skillsHome });
      const runtimeFile = path.join(codexHome, 'hooks', 'elegy-workflow-improvement', 'elegy-codex-hook.mjs');
      const hooksPath = path.join(codexHome, 'hooks.json');
      const receiptPath = path.join(codexHome, '.elegy-codex-hooks.json');
      const hooksBefore = fs.readFileSync(hooksPath, 'utf8');
      const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
      fs.appendFileSync(runtimeFile, '\n// user drift\n', 'utf8');

      const result = installer.runInstall({ codexHome, skillsHome });

      assert.strictEqual(result.hooks.enabled, false);
      assert.strictEqual(result.hooks.action, 'skipped_conflict');
      assert.strictEqual(fs.readFileSync(hooksPath, 'utf8'), hooksBefore);
      assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore);
    });
  });

  await test('uninstall ignores unvalidated receipt signatures and preserves their unrelated hook', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, 'Codex Home');
      const skillsHome = path.join(codexHome, 'skills');
      installer.runInstall({ force: true, codexHome, skillsHome });
      const hooksPath = path.join(codexHome, 'hooks.json');
      const receiptPath = path.join(codexHome, '.elegy-codex-hooks.json');
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      const unrelated = { type: 'command', command: 'node "C:\\User Hooks\\keep.mjs"', commandWindows: 'node "C:\\User Hooks\\keep.mjs"' };
      hooks.hooks.Stop.push({ hooks: [unrelated] });
      fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.runtimeDirectory = path.join(root, 'not-the-managed-runtime');
      receipt.managedHandlers.push({ event: 'Stop', ...unrelated });
      fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

      installer.runInstall({ uninstallHooks: true, codexHome, skillsHome });
      const after = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      assert.ok(after.hooks.Stop.flatMap((group) => group.hooks)
        .some((hook) => hook.command === unrelated.command && hook.commandWindows === unrelated.commandWindows));
    });
  });

  await test('installer upgrades an older managed AGENTS.md but preserves user edits', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      const agentsPath = path.join(codexHome, 'AGENTS.md');
      const inventoryPath = path.join(codexHome, '.elegy-copilot-codex-managed.json');

      installer.runInstall({ force: true, codexHome, skillsHome });
      const currentInstructions = fs.readFileSync(agentsPath, 'utf8');

      const oldManagedInstructions = '# Older managed Codex instructions\n';
      fs.writeFileSync(agentsPath, oldManagedInstructions, 'utf8');
      const oldInventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      oldInventory.instructions['AGENTS.md'] = shaText(oldManagedInstructions);
      fs.writeFileSync(inventoryPath, `${JSON.stringify(oldInventory, null, 2)}\n`, 'utf8');

      const upgradeSummary = installer.runInstall({ codexHome, skillsHome });
      assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), currentInstructions);
      assert.ok(
        upgradeSummary.assets.some((asset) => asset.id === 'codex-global-instructions' && asset.action === 'updated'),
        'expected the previously managed global instructions to upgrade without --force',
      );

      const userInstructions = `${currentInstructions}\n# Local user customization\n`;
      fs.writeFileSync(agentsPath, userInstructions, 'utf8');
      const preserveSummary = installer.runInstall({ codexHome, skillsHome });
      assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), userInstructions);
      assert.ok(
        preserveSummary.assets.some((asset) => asset.id === 'codex-global-instructions' && asset.action === 'skipped_conflict'),
        'expected a user-modified global instructions file to remain untouched',
      );
      const preservedInventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      assert.strictEqual(preservedInventory.instructions['AGENTS.md'], shaText(currentInstructions));
    });
  });

  await test('installer reports a global override that suppresses managed AGENTS.md', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(path.join(codexHome, 'AGENTS.override.md'), '# Temporary override\n', 'utf8');

      const summary = installer.runInstall({ force: true, codexHome, skillsHome });
      assert.strictEqual(summary.instructions.overridePresent, true);
      assert.strictEqual(summary.instructions.activeGlobalPath, path.join(codexHome, 'AGENTS.override.md'));
      assert.ok(fs.existsSync(summary.instructions.managedPath));
    });
  });

  await test('installer prunes removed managed skills but preserves diverged copies', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      const inventoryPath = path.join(codexHome, '.elegy-copilot-codex-managed.json');
      installer.runInstall({ force: true, codexHome, skillsHome });

      const staleSkillPath = path.join(skillsHome, 'spec-dev');
      const staleSourcePath = path.resolve(__dirname, '..', 'catalog-assets', 'shared-skills', 'spec-dev');
      fs.cpSync(staleSourcePath, staleSkillPath, { recursive: true });

      const divergedSkillPath = path.join(skillsHome, 'implementation-review');
      fs.mkdirSync(divergedSkillPath, { recursive: true });
      fs.writeFileSync(path.join(divergedSkillPath, 'SKILL.md'), '# User-owned implementation review\n', 'utf8');

      const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      inventory.skills['spec-dev'] = dirHash(staleSkillPath);
      inventory.skills['implementation-review'] = dirHash(
        path.resolve(__dirname, '..', 'catalog-assets', 'shared-skills', 'implementation-review'),
      );
      fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

      const summary = installer.runInstall({ codexHome, skillsHome });
      assert.ok(!fs.existsSync(staleSkillPath), 'removed managed skill should be pruned');
      assert.ok(fs.existsSync(divergedSkillPath), 'diverged skill should remain user-owned');
      assert.ok(summary.cleanup.pruneResults.some(
        (entry) => entry.action === 'pruned' && entry.path === staleSkillPath,
      ));
      assert.ok(summary.cleanup.pruneResults.some(
        (entry) => entry.action === 'skipped_prune_conflict' && entry.path === divergedSkillPath,
      ));
    });
  });

  await test('managed-only installer syncs Elegy assets without touching native Codex state', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');

      installer.runInstall({
        force: true,
        codexHome,
        skillsHome,
      });

      const explorerPath = path.join(codexHome, 'agents', 'explorer.toml');
      const configPath = path.join(codexHome, 'config.toml');
      const nativeAgent = fs.readFileSync(explorerPath, 'utf8');
      const nativeConfig = fs.readFileSync(configPath, 'utf8');
      fs.writeFileSync(explorerPath, `${nativeAgent}\n# Codex-owned customization\n`, 'utf8');
      fs.writeFileSync(configPath, `${nativeConfig}\n# Codex-owned configuration\n`, 'utf8');

      installer.runInstall({
        force: true,
        managedOnly: true,
        skipConfig: true,
        codexHome,
        skillsHome,
      });

      assert.match(fs.readFileSync(explorerPath, 'utf8'), /Codex-owned customization/);
      assert.match(fs.readFileSync(configPath, 'utf8'), /Codex-owned configuration/);
      const configToml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      const profileToml = fs.readFileSync(path.join(codexHome, 'instruction_engine_plan_review.config.toml'), 'utf8');
      assert.equal(configToml, fs.readFileSync(configPath, 'utf8'));
      assert.equal(profileToml, fs.readFileSync(path.join(codexHome, 'instruction_engine_plan_review.config.toml'), 'utf8'));
      assert.ok(fs.existsSync(path.join(skillsHome, 'repo-setup', 'SKILL.md')));
    });
  });

  await test('skip-config preserves the existing managed profile while updating native agent assets', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');

      installer.runInstall({ force: true, skipHooks: true, codexHome, skillsHome });
      const profilePath = path.join(codexHome, 'instruction_engine_plan_review.config.toml');
      const profileBefore = fs.readFileSync(profilePath, 'utf8');
      fs.writeFileSync(profilePath, `${profileBefore}\n# Preserve this profile while installing workflow assets.\n`, 'utf8');

      const summary = installer.runInstall({ force: true, skipHooks: true, skipConfig: true, codexHome, skillsHome });

      assert.match(fs.readFileSync(profilePath, 'utf8'), /Preserve this profile/);
      assert.ok(!summary.cleanup.pruneResults.some(
        (entry) => entry.path === profilePath,
      ));
      const inventory = JSON.parse(fs.readFileSync(path.join(codexHome, '.elegy-copilot-codex-managed.json'), 'utf8'));
      assert.ok(inventory.configFiles['instruction_engine_plan_review.config.toml']);
      assert.ok(fs.existsSync(path.join(skillsHome, 'goal-session-workflow', 'SKILL.md')));
      assert.ok(fs.readFileSync(path.join(codexHome, 'agents', 'reviewer_strong.toml'), 'utf8').includes('AGENT_CONTEXT_PACKET'));
    });
  });

  await test('managed-only installer prunes retired Elegy-managed skills', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      installer.runInstall({ force: true, codexHome, skillsHome });

      const retiredSkillPath = path.join(skillsHome, 'elegy-planning');
      fs.mkdirSync(retiredSkillPath, { recursive: true });
      fs.writeFileSync(path.join(retiredSkillPath, 'SKILL.md'), '# Retired skill\n', 'utf8');
      const inventoryPath = path.join(codexHome, '.elegy-copilot-codex-managed.json');
      const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      inventory.skills['elegy-planning'] = dirHash(retiredSkillPath);
      fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

      const summary = installer.runInstall({ managedOnly: true, skipConfig: true, codexHome, skillsHome });

      assert.equal(fs.existsSync(retiredSkillPath), false);
      assert.ok(summary.cleanup.pruneResults.some(
        (entry) => entry.action === 'pruned' && entry.path === retiredSkillPath,
      ));
    });
  });

  await test('installer bootstraps opt-in spec-driven repo files', async () => {
    withTempDir((root) => {
      const shim = createTestElegyCliShim(root);
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      const repoRoot = path.join(root, 'target-repo');
      fs.mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, '.github', 'skills', 'repo-helper'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Target Repo\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'docs', 'index.md'), '# Docs\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'package.json'), `${JSON.stringify({ name: 'target-repo', scripts: {} }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), '# Repo Notes\n\nKeep this section.\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, '.github', 'skills', 'repo-helper', 'SKILL.md'), '---\nname: repo-helper\ndescription: Repo helper\n---\n', 'utf8');

      const summary = withWorkingDirectory(shim.shimDir, () => installer.runInstall({
        force: true,
        codexHome,
        skillsHome,
        repoRoot,
        elegyCliPath: shim.elegyCliPath,
        setupProfile: 'spec-driven',
      }));

      const copilotInstructions = fs.readFileSync(path.join(repoRoot, '.github', 'copilot-instructions.md'), 'utf8');
      const agentsInstructions = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
      const specsIndex = fs.readFileSync(path.join(repoRoot, 'docs', 'specs', 'index.md'), 'utf8');
      assert.ok(copilotInstructions.includes('elegy-copilot:begin spec-driven'));
      assert.ok(copilotInstructions.includes('spec-authoring'));
      assert.ok(agentsInstructions.includes('Keep this section.'));
      assert.ok(agentsInstructions.includes('elegy-copilot:begin spec-driven'));
      assert.ok(specsIndex.includes('# Specs'));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'agents')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'skills')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'repo-helper', 'SKILL.md')));
      assert.strictEqual(summary.repoSetup.profileKey, 'spec-driven');
      assert.strictEqual(summary.repoSetup.repoInstructionFile, 'AGENTS.md');
      assert.ok(summary.repoSetup.skillMirrors.counts.created > 0 || summary.repoSetup.skillMirrors.counts.skipped > 0);

      fs.writeFileSync(path.join(repoRoot, 'docs', 'specs', 'index.md'), '# Specs\n\n- Custom entry\n', 'utf8');
      withWorkingDirectory(shim.shimDir, () => installer.runInstall({
        codexHome,
        skillsHome,
        repoRoot,
        elegyCliPath: shim.elegyCliPath,
        setupProfile: 'spec-driven',
      }));
      assert.ok(fs.readFileSync(path.join(repoRoot, 'docs', 'specs', 'index.md'), 'utf8').includes('Custom entry'));
    });
  });

  await test('path resolution supports explicit and HOME-derived destinations', async () => {
    const previousHome = process.env.HOME;
    const previousSkillsHome = process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME;
    try {
      process.env.HOME = path.join(os.tmpdir(), 'codex-home-base');
      delete process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME;

      assert.strictEqual(
        installer.resolveCodexHome(path.join('C:\\temp', 'codex')),
        path.resolve(path.join('C:\\temp', 'codex')),
      );
      assert.strictEqual(
        installer.resolveSkillsHome(''),
        path.join(process.env.HOME, '.codex', 'skills'),
      );
      assert.strictEqual(
        installer.resolveSkillsHome('', path.join(process.env.HOME, 'custom-codex-home')),
        path.join(process.env.HOME, 'custom-codex-home', 'skills'),
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      if (previousSkillsHome === undefined) {
        delete process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME;
      } else {
        process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME = previousSkillsHome;
      }
    }
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
