#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { createTestElegyCliShim, withWorkingDirectory } = require('./test-elegy-cli-shim.js');

let passed = 0;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-opencode-install-'));
  function cleanup() {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  try {
    const result = fn(dir);
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup);
    }
    return result;
  } catch (error) {
    cleanup();
    throw error;
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
  const installerPath = pathToFileURL(path.resolve(__dirname, 'opencode-install.mjs')).href;
  const utilsPath = pathToFileURL(path.resolve(__dirname, 'install-surface-utils.mjs')).href;
  const installer = await import(installerPath);
  const utils = await import(utilsPath);

  await test('installer creates curated OpenCode assets and reruns idempotently', async () => {
    await withTempDir(async (root) => {
      const opencodeHome = path.join(root, '.config', 'opencode');
      const skillsHome = path.join(opencodeHome, 'skills');
      const agentsDir = path.join(opencodeHome, 'agents');

      const firstSummary = await installer.runInstall({
        force: true,
        opencodeHome,
        skillsHome,
      });

      const agentsMdPath = path.join(opencodeHome, 'AGENTS.md');
      assert.ok(fs.existsSync(agentsMdPath));
      const agentsMdContent = fs.readFileSync(agentsMdPath, 'utf8');
      assert.ok(agentsMdContent.includes('Agent Session Defaults'), 'AGENTS.md should contain the baseline');
      assert.ok(agentsMdContent.includes('Harness Appendix'), 'AGENTS.md should contain harness appendix');
      assert.ok(fs.existsSync(path.join(skillsHome, 'rubberduck-plan-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'implementation-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'implementation-handoff', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'skill-discovery', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-dev', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-authoring', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'security', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'project-conventions-governance', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(opencodeHome, '.instruction-engine-opencode-managed.json')));
      assert.ok(firstSummary.counts.created > 0);
      const opencodeConfig = JSON.parse(fs.readFileSync(path.join(opencodeHome, 'opencode.jsonc'), 'utf8'));
      assert.ok(opencodeConfig.plugin.includes('./plugins/worktree.js'), 'worktree plugin should be registered');
      assert.ok(opencodeConfig.plugin.includes('./plugins/planning.js'), 'planning plugin should be registered');
      assert.ok(opencodeConfig.plugin.includes('./plugins/notify.js'), 'notify plugin should be registered');

      // R8: verify all 4 lane agents are installed
      for (const agent of ['quick', 'standard', 'spec', 'project']) {
        assert.ok(fs.existsSync(path.join(agentsDir, `${agent}.md`)), `lane agent ${agent}.md should exist`);
      }
      // R8: verify all 3 required subagents are installed
      for (const subagent of ['impl', 'reviewer', 'explorer']) {
        assert.ok(fs.existsSync(path.join(agentsDir, `${subagent}.md`)), `subagent ${subagent}.md should exist`);
      }

      // R9: verify agent count is exactly 4 primary lanes + 3 hidden subagents = 7 total
      const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      assert.strictEqual(agentFiles.length, 7,
        `agent count should be exactly 7 (4 lanes + 3 subagents), found ${agentFiles.length}: ${agentFiles.join(', ')}`);

      const secondSummary = await installer.runInstall({
        opencodeHome,
        skillsHome,
      });
      assert.ok(secondSummary.counts.skipped > 0, 'expected idempotent rerun to skip up-to-date assets');
    });
  });

  await test('installer prunes stale managed assets and preserves diverged files', async () => {
    await withTempDir(async (root) => {
      const opencodeHome = path.join(root, '.config', 'opencode');
      const skillsHome = path.join(opencodeHome, 'skills');
      const inventoryPath = path.join(opencodeHome, '.instruction-engine-opencode-managed.json');

      await installer.runInstall({
        force: true,
        opencodeHome,
        skillsHome,
      });

      const staleAgentPath = path.join(opencodeHome, 'agents', 'legacy-agent.md');
      fs.writeFileSync(staleAgentPath, 'legacy managed agent\n', 'utf8');

      const divergedAgentPath = path.join(opencodeHome, 'agents', 'edited-agent.md');
      fs.writeFileSync(divergedAgentPath, 'user modified content\n', 'utf8');

      const staleSkillPath = path.join(skillsHome, 'legacy-skill');
      fs.mkdirSync(staleSkillPath, { recursive: true });
      fs.writeFileSync(path.join(staleSkillPath, 'SKILL.md'), '---\nname: legacy-skill\ndescription: legacy\n---\n', 'utf8');

      const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      inventory.agents['legacy-agent.md'] = utils.shaFile(staleAgentPath);
      inventory.agents['edited-agent.md'] = utils.shaText('original managed content\n');
      inventory.skills['legacy-skill'] = utils.dirHash(staleSkillPath);
      fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

      const summary = await installer.runInstall({
        opencodeHome,
        skillsHome,
      });

      assert.ok(!fs.existsSync(staleAgentPath), 'stale managed agent should be pruned');
      assert.ok(!fs.existsSync(staleSkillPath), 'stale managed skill should be pruned');
      assert.ok(fs.existsSync(divergedAgentPath), 'diverged agent should be preserved');
      assert.ok(summary.cleanup.pruneResults.some((entry) => entry.action === 'pruned' && entry.path === staleAgentPath));
      assert.ok(summary.cleanup.pruneResults.some((entry) => entry.action === 'pruned' && entry.path === staleSkillPath));
      assert.ok(summary.cleanup.pruneResults.some((entry) => entry.action === 'skipped_prune_conflict' && entry.path === divergedAgentPath));
    });
  });

  await test('installer dry-run resolves explicit homes without creating files', async () => {
    await withTempDir(async (root) => {
      const opencodeHome = path.join(root, 'opencode-home');
      const skillsHome = path.join(opencodeHome, 'skills');

      const summary = await installer.runInstall({
        dryRun: true,
        force: true,
        opencodeHome,
        skillsHome,
      });

      assert.ok(!fs.existsSync(opencodeHome));
      assert.ok(!fs.existsSync(skillsHome));
      assert.ok(summary.counts.wouldCreate > 0 || summary.counts.wouldUpdate > 0 || summary.counts.wouldPrune > 0);
    });
  });

  await test('installer bootstraps opt-in spec-driven repo files', async () => {
    await withTempDir(async (root) => {
      const shim = createTestElegyCliShim(root);
      const opencodeHome = path.join(root, '.config', 'opencode');
      const skillsHome = path.join(opencodeHome, 'skills');
      const repoRoot = path.join(root, 'target-repo');
      fs.mkdirSync(path.join(repoRoot, 'docs', 'system'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, '.github', 'skills', 'repo-helper'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Target Repo\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'docs', 'system', 'index.md'), '# System Docs\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'package.json'), `${JSON.stringify({ name: 'target-repo', scripts: {} }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(repoRoot, '.github', 'skills', 'repo-helper', 'SKILL.md'), '---\nname: repo-helper\ndescription: Repo helper\n---\n', 'utf8');

      const summary = await withWorkingDirectory(shim.shimDir, () => installer.runInstall({
        force: true,
        opencodeHome,
        skillsHome,
        repoRoot,
        elegyCliPath: shim.elegyCliPath,
        setupProfile: 'spec-driven',
      }));

      const copilotInstructions = fs.readFileSync(path.join(repoRoot, '.github', 'copilot-instructions.md'), 'utf8');
      const agentsInstructions = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
      const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

      assert.ok(copilotInstructions.includes('instruction-engine:begin spec-driven'));
      assert.ok(agentsInstructions.includes('instruction-engine:begin spec-driven'));
      assert.ok(fs.existsSync(path.join(repoRoot, 'docs', 'specs', 'index.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', 'validate-specs.js')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'agents')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.opencode', 'skills', 'repo-helper', 'SKILL.md')));
      assert.strictEqual(packageJson.scripts['validate:specs'], 'node scripts/validate-specs.js');
      assert.strictEqual(summary.repoSetup.profileKey, 'spec-driven');
      assert.strictEqual(summary.repoSetup.repoInstructionFile, 'AGENTS.md');
      assert.ok(summary.repoSetup.skillMirrors.counts.created > 0 || summary.repoSetup.skillMirrors.counts.skipped > 0);
    });
  });

  await test('path resolution supports explicit and HOME-derived destinations', async () => {
    const previousHome = process.env.HOME;
    const previousSkillsHome = process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME;
    try {
      process.env.HOME = path.join(os.tmpdir(), 'opencode-home-base');
      delete process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME;

      assert.strictEqual(
        installer.resolveOpenCodeHome(path.join('C:\\temp', 'opencode')),
        path.resolve(path.join('C:\\temp', 'opencode')),
      );
      assert.strictEqual(
        installer.resolveSkillsHome('', path.join(process.env.HOME, '.config', 'opencode')),
        path.join(process.env.HOME, '.config', 'opencode', 'skills'),
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      if (previousSkillsHome === undefined) {
        delete process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME;
      } else {
        process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME = previousSkillsHome;
      }
    }
  });

  // R8: lane quality validators pass against source files (run as subprocess)
  await test('lane doc refs validator passes', async () => {
    execFileSync('node', ['scripts/validate-lane-doc-refs.js'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
    });
  });

  await test('lane prompt sections validator passes', async () => {
    execFileSync('node', ['scripts/validate-lane-prompt-sections.js'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
    });
  });

  await test('profile role coverage validator passes', async () => {
    execFileSync('node', ['scripts/validate-profile-role-coverage.js'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
    });
  });

  await test('elegy command refs validator passes', async () => {
    execFileSync('node', ['scripts/validate-elegy-command-refs.js'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
    });
  });

  // R9: installed agents match manifest and profiles agent-level validation
  await test('installed agents match manifest count and every agentRole has model', async () => {
    await withTempDir(async (root) => {
      const opencodeHome = path.join(root, '.config', 'opencode');
      const skillsHome = path.join(opencodeHome, 'skills');
      const agentsDir = path.join(opencodeHome, 'agents');

      await installer.runInstall({
        force: true,
        opencodeHome,
        skillsHome,
      });

      // Verify agent count = manifest count (7)
      const manifestPath = path.resolve(__dirname, '..', 'opencode-assets', 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const manifestAgentCount = manifest.assets.filter(a => a.type === 'agent').length;
      const installedAgentCount = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).length;
      assert.strictEqual(installedAgentCount, manifestAgentCount,
        `installed agents (${installedAgentCount}) should match manifest count (${manifestAgentCount})`);

      // Verify every agentRoles key has model + reasoningEffort in installed agent file
      const profilesPath = path.resolve(__dirname, '..', 'opencode-assets', 'profiles.json');
      const profilesConfig = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
      const agentRoles = profilesConfig.agentRoles || {};

      // Parse simple YAML frontmatter
      function parseFrontmatter(fileContent) {
        const match = String(fileContent).match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match) return {};
        const meta = {};
        for (const line of match[1].split(/\r?\n/)) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            let val = line.slice(colonIdx + 1).trim();
            val = val.replace(/^['"]|['"]$/g, '');
            meta[key] = val;
          }
        }
        return meta;
      }

      for (const [agentName, roleKey] of Object.entries(agentRoles)) {
        const agentPath = path.join(agentsDir, `${agentName}.md`);
        assert.ok(fs.existsSync(agentPath), `agentRole '${agentName}' has installed file ${agentName}.md`);

        const agentContent = fs.readFileSync(agentPath, 'utf8');
        const frontmatter = parseFrontmatter(agentContent);

        assert.ok(frontmatter.model,
          `agentRole '${agentName}' (${agentName}.md) must have 'model' in frontmatter (role: ${roleKey})`);
        assert.ok(frontmatter.reasoningEffort,
          `agentRole '${agentName}' (${agentName}.md) must have 'reasoningEffort' in frontmatter (role: ${roleKey})`);
      }
    });
  });

  await test('install writes roleModels into profile injection', async () => {
    await withTempDir(async (root) => {
      const opencodeHome = path.join(root, '.config', 'opencode');
      const skillsHome = path.join(opencodeHome, 'skills');
      
      const summary = await installer.runInstall({
        force: true,
        opencodeHome,
        skillsHome,
      });
      
      // Verify profile injection shows all agents assigned to correct roles
      if (summary.profileInjection && summary.profileInjection.length > 0) {
        // impl should be on implementation role (Flash)
        const implInjection = summary.profileInjection.find(r => r.agent === 'impl');
        assert.ok(implInjection, 'impl should be in profile injection');
        assert.ok(implInjection.newModel.includes('flash'), 'impl should route to Flash');
        
        // project should be on planning role (Pro)
        const projectInjection = summary.profileInjection.find(r => r.agent === 'project');
        assert.ok(projectInjection, 'project should be in profile injection');
        assert.ok(projectInjection.newModel.includes('pro'), 'project should route to Pro');
        
        // quick should be on implementation role (Flash)
        const quickInjection = summary.profileInjection.find(r => r.agent === 'quick');
        assert.ok(quickInjection, 'quick should be in profile injection');
        assert.ok(quickInjection.newModel.includes('flash'), 'quick should route to Flash');
      }
    });
  });

  // R10: alias-surface validator passes
  await test('opencode alias surface validator passes', async () => {
    execFileSync('node', ['scripts/validate-opencode-alias-surface.js'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
    });
  });

  // R11: worktree plugin is loadable and exports expected structure
  await test('worktree plugin loads and exports expected tools', async () => {
    const pluginSourcePath = path.resolve(__dirname, '..', 'opencode-assets', 'plugins', 'worktree.js');
    assert.ok(fs.existsSync(pluginSourcePath), 'plugin source file should exist');

    // Dynamic import from .opencode dir where node_modules are available
    const opencodeDir = path.resolve(__dirname, '..', '.opencode');
    const { pathToFileURL } = require('url');
    const pluginUrl = pathToFileURL(pluginSourcePath).href;

    // Set OPENCODE_WORKTREE_BASE to a temp dir to avoid side effects
    const wtBase = path.join(os.tmpdir(), 'ie-plugin-smoke-' + Date.now());
    const prevBase = process.env.OPENCODE_WORKTREE_BASE;
    process.env.OPENCODE_WORKTREE_BASE = wtBase;
    try {
      const mod = await import(pluginUrl);
      assert.strictEqual(typeof mod.WorktreePlugin, 'function', 'WorktreePlugin should be a function');

      const plugin = await mod.WorktreePlugin({ project: { path: path.resolve(__dirname, '..') } });
      assert.ok(plugin.tool, 'should have tool property');
      assert.strictEqual(typeof plugin.tool.worktree_create, 'object', 'worktree_create should be a tool object');
      assert.strictEqual(typeof plugin.tool.worktree_list, 'object', 'worktree_list should be a tool object');
      assert.strictEqual(typeof plugin.tool.worktree_delete, 'object', 'worktree_delete should be a tool object');
      assert.strictEqual(typeof plugin.tool.worktree_create.execute, 'function', 'worktree_create.execute should be a function');
      assert.strictEqual(typeof plugin['shell.env'], 'function', 'shell.env should be a function');
    } finally {
      if (prevBase === undefined) {
        delete process.env.OPENCODE_WORKTREE_BASE;
      } else {
        process.env.OPENCODE_WORKTREE_BASE = prevBase;
      }
      try { fs.rmSync(wtBase, { recursive: true, force: true }); } catch {}
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
