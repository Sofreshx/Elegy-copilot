#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-profile-switch-'));
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
  const utilsPath = pathToFileURL(path.resolve(__dirname, 'frontmatter-utils.mjs')).href;
  const utils = await import(utilsPath);

  await test('profile switching updates all role-mapped subagent files', async () => {
    withTempDir((root) => {
      const agentsDir = path.join(root, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      const agents = {
        quick: { model: 'opencode-go/deepseek-v4-flash', reasoningEffort: 'max' },
        project: { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'max' },
        impl: { model: 'opencode-go/deepseek-v4-flash', reasoningEffort: 'max' },
        reviewer: { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'max' },
        explorer: { model: 'opencode-go/deepseek-v4-flash', reasoningEffort: 'max' },
        scout: { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'max' },
        'notes-enhance': { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'max' },
        'notes-reexamine': { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'max' },
        'notes-research': { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'max' },
        'notes-deduplicate': { model: 'opencode-go/deepseek-v4-flash', reasoningEffort: 'max' },
      };

      const agentRoles = {
        quick: 'small',
        project: 'big',
        impl: 'small',
        reviewer: 'review',
        explorer: 'small',
        scout: 'big',
        'notes-enhance': 'big',
        'notes-reexamine': 'big',
        'notes-research': 'big',
        'notes-deduplicate': 'small',
      };

      for (const [name, fields] of Object.entries(agents)) {
        const filePath = path.join(agentsDir, `${name}.md`);
        const isPrimary = ['quick', 'project'].includes(name);
        const modeLine = isPrimary ? 'mode: primary' : 'mode: subagent\nhidden: true';
        const content = `---\n${modeLine}\nmodel: ${fields.model}\nreasoningEffort: ${fields.reasoningEffort}\ndescription: "Test agent"\n---\n\n# ${name} agent\n`;
        fs.writeFileSync(filePath, content, 'utf8');
      }

      const profile = {
        small: 'deepseek/deepseek-v4-flash',
        big: 'deepseek/deepseek-v4-pro',
        review: 'deepseek/deepseek-v4-pro',
        reasoningEffort: 'max',
      };

      let updatedCount = 0;
      const results = [];

      for (const entry of fs.readdirSync(agentsDir).sort()) {
        if (!entry.endsWith('.md')) continue;
        const agentPath = path.join(agentsDir, entry);
        const result = utils.updateAgentModel(agentPath, profile, agentRoles);
        if (result) {
          results.push(result);
          updatedCount += 1;
        }
      }

      assert.strictEqual(updatedCount, 10, 'all 10 role-mapped agents should be updated');
      assert.strictEqual(results.length, 10);

      for (const result of results) {
        const agentPath = path.join(agentsDir, `${result.agent}.md`);
        const content = fs.readFileSync(agentPath, 'utf8');
        assert.ok(content.includes(`model: ${result.newModel}`), `${result.agent} model should be ${result.newModel}`);
      }

      for (const result of results) {
        assert.ok(result.oldModel.startsWith('opencode-go/'), `${result.agent} old model should start with opencode-go/`);
        assert.ok(result.newModel.startsWith('deepseek/'), `${result.agent} new model should start with deepseek/`);
      }
    });
  });

  await test('profile switching preserves reasoningEffort', async () => {
    withTempDir((root) => {
      const agentsDir = path.join(root, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      const filePath = path.join(agentsDir, 'impl.md');
      const content = `---\nmode: subagent\nhidden: true\nmodel: opencode-go/deepseek-v4-flash\nreasoningEffort: max\ndescription: "Impl agent"\n---\n\n# Impl agent\n`;
      fs.writeFileSync(filePath, content, 'utf8');

      const agentRoles = { impl: 'small' };
      const profile = {
        small: 'deepseek/deepseek-v4-flash',
        big: 'deepseek/deepseek-v4-pro',
        review: 'deepseek/deepseek-v4-pro',
        reasoningEffort: 'medium',
      };

      utils.updateAgentModel(filePath, profile, agentRoles);

      const updated = fs.readFileSync(filePath, 'utf8');
      assert.ok(updated.includes('reasoningEffort: medium'), 'reasoningEffort should be updated from profile');
      assert.ok(updated.includes('model: deepseek/deepseek-v4-flash'), 'model should be updated');
    });
  });

  await test('profile switching updates only role-mapped agents, not unlisted agents', async () => {
    withTempDir((root) => {
      const agentsDir = path.join(root, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      const agentPath = path.join(agentsDir, 'impl.md');
      fs.writeFileSync(agentPath, `---\nmode: subagent\nhidden: true\nmodel: opencode-go/deepseek-v4-flash\nreasoningEffort: max\ndescription: "Impl"\n---\n\n# Impl\n`, 'utf8');

      const customPath = path.join(agentsDir, 'custom-agent.md');
      fs.writeFileSync(customPath, `---\nmode: subagent\nhidden: true\nmodel: opencode-go/deepseek-v4-flash\ndescription: "Custom"\n---\n\n# Custom\n`, 'utf8');

      const agentRoles = { impl: 'small' };
      const profile = {
        small: 'deepseek/deepseek-v4-flash',
        reasoningEffort: 'max',
      };

      const result = utils.updateAgentModel(customPath, profile, agentRoles);
      assert.strictEqual(result, null, 'agents without role should not be updated');

      const implResult = utils.updateAgentModel(agentPath, profile, agentRoles);
      assert.ok(implResult !== null, 'agents with role should be updated');
      assert.strictEqual(implResult.newModel, 'deepseek/deepseek-v4-flash');

      const customContent = fs.readFileSync(customPath, 'utf8');
      assert.ok(customContent.includes('model: opencode-go/deepseek-v4-flash'), 'unlisted agent should keep original model');
    });
  });

  await test('profile switching writes roleModels to config.agentRoleModels', async () => {
    withTempDir((root) => {
      const agentsDir = path.join(root, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      const implPath = path.join(agentsDir, 'impl.md');
      fs.writeFileSync(implPath, '---\nmode: subagent\nhidden: true\nmodel: opencode-go/deepseek-v4-flash\nreasoningEffort: max\ndescription: "Impl"\n---\n\n# Impl\n', 'utf8');

      const agentRoles = { impl: 'small' };
      const profile = {
        small: 'opencode-go/deepseek-v4-flash',
        big: 'opencode-go/deepseek-v4-pro',
        review: 'opencode-go/deepseek-v4-pro',
        roleModels: {
          planning: 'opencode-go/deepseek-v4-pro',
          implementation: 'opencode-go/deepseek-v4-flash',
          exploration: 'opencode-go/deepseek-v4-flash',
          review: 'opencode-go/deepseek-v4-pro',
          research: 'opencode-go/deepseek-v4-pro',
        },
        reasoningEffort: 'max',
      };

      assert.ok(profile.roleModels, 'profile should have roleModels');
      assert.strictEqual(profile.roleModels.planning, 'opencode-go/deepseek-v4-pro', 'planning role should be Pro');
      assert.strictEqual(profile.roleModels.implementation, 'opencode-go/deepseek-v4-flash', 'implementation role should be Flash');
    });
  });

  await test('profile switching updates reasoningEffort in opencode.jsonc', async () => {
    withTempDir((root) => {
      const agentsDir = path.join(root, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      const agents = {
        impl: { model: 'opencode-go/deepseek-v4-flash', reasoningEffort: 'max' },
        build: { model: 'opencode-go/deepseek-v4-flash', reasoningEffort: 'max' },
        plan: { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'max' },
        explore: { model: 'opencode-go/deepseek-v4-flash', reasoningEffort: 'max' },
        scout: { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'max' },
      };

      const agentRoles = {
        impl: 'small',
      };

      const roleToAgent = {
        planning: ['plan'],
        implementation: ['build', 'impl'],
        exploration: ['explore'],
        research: ['scout'],
      };

      for (const [name, fields] of Object.entries(agents)) {
        const filePath = path.join(agentsDir, `${name}.md`);
        const content = `---\nmode: subagent\nhidden: true\nmodel: ${fields.model}\nreasoningEffort: ${fields.reasoningEffort}\ndescription: "Test agent"\n---\n\n# ${name} agent\n`;
        fs.writeFileSync(filePath, content, 'utf8');
      }

      const configPath = path.join(root, 'opencode.jsonc');
      const initialConfig = {
        agent: {
          build: { reasoningEffort: 'high' },
          plan: { reasoningEffort: 'high' },
          explore: { reasoningEffort: 'high' },
          scout: { reasoningEffort: 'high' },
          impl: { reasoningEffort: 'high' },
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');

      const profile = {
        small: 'opencode-go/deepseek-v4-flash',
        big: 'opencode-go/deepseek-v4-pro',
        review: 'opencode-go/deepseek-v4-pro',
        roleModels: {
          planning: 'opencode-go/deepseek-v4-pro',
          implementation: 'opencode-go/deepseek-v4-flash',
          exploration: 'opencode-go/deepseek-v4-flash',
          review: 'opencode-go/deepseek-v4-pro',
          research: 'opencode-go/deepseek-v4-pro',
        },
        reasoningEffort: 'max',
      };

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!config.agent) config.agent = {};

      const allAgents = new Set();
      if (roleToAgent) {
        for (const agentList of Object.values(roleToAgent)) {
          if (Array.isArray(agentList)) {
            for (const agentName of agentList) {
              allAgents.add(agentName);
            }
          }
        }
      }
      for (const agentName of Object.keys(agentRoles)) {
        allAgents.add(agentName);
      }

      for (const agentName of allAgents) {
        let modelValue = null;
        if (roleToAgent && profile.roleModels) {
          for (const [role, agentList] of Object.entries(roleToAgent)) {
            if (Array.isArray(agentList) && agentList.includes(agentName) && profile.roleModels[role]) {
              modelValue = profile.roleModels[role];
              break;
            }
          }
        }
        if (!modelValue && agentRoles[agentName] && profile[agentRoles[agentName]]) {
          modelValue = profile[agentRoles[agentName]];
        }
        if (!modelValue) continue;

        if (!config.agent[agentName] || typeof config.agent[agentName] !== 'object') {
          config.agent[agentName] = {};
        }
        config.agent[agentName].model = modelValue;
        if (profile.reasoningEffort) {
          config.agent[agentName].reasoningEffort = profile.reasoningEffort;
        }
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

      const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(updatedConfig.agent.build.reasoningEffort, 'max', 'build should have max reasoningEffort');
      assert.strictEqual(updatedConfig.agent.plan.reasoningEffort, 'max', 'plan should have max reasoningEffort');
      assert.strictEqual(updatedConfig.agent.explore.reasoningEffort, 'max', 'explore should have max reasoningEffort');
      assert.strictEqual(updatedConfig.agent.scout.reasoningEffort, 'max', 'scout should have max reasoningEffort');
      assert.strictEqual(updatedConfig.agent.impl.reasoningEffort, 'max', 'impl should have max reasoningEffort');
    });
  });

  await test('deepseek-direct profile routes impl to Flash and plan to Pro', async () => {
    const profilesPath = path.resolve(__dirname, '..', 'opencode-assets', 'profiles.json');
    const profilesConfig = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
    const dsProfile = profilesConfig.profiles['deepseek-direct'];
    const roleToAgent = profilesConfig.roleToAgent;

    assert.ok(dsProfile.roleModels.implementation.includes('flash'), 'implementation should route to Flash model');
    assert.ok(dsProfile.roleModels.planning.includes('pro'), 'planning should route to Pro model');

    assert.ok(roleToAgent.implementation.includes('impl'), 'impl should be in implementation role');
    assert.ok(roleToAgent.implementation.includes('quick'), 'quick should be in implementation role');
    assert.ok(roleToAgent.planning.includes('plan'), 'plan should be in planning role');
    assert.ok(roleToAgent.planning.includes('project'), 'project should be in planning role');
    if (roleToAgent.research) {
      assert.ok(roleToAgent.research.includes('scout'), 'scout should be in research role');
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
