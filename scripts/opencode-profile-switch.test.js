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

function createAgentFile(content) {
  return content;
}

async function main() {
  const utilsPath = pathToFileURL(path.resolve(__dirname, 'frontmatter-utils.mjs')).href;
  const utils = await import(utilsPath);

  await test('profile switching updates all role-mapped agent files', async () => {
    withTempDir((root) => {
      const agentsDir = path.join(root, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      // Create mock agent files matching agentRoles keys
      const agents = {
        quick: { model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'max' },
        standard: { model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'max' },
        spec: { model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'max' },
        project: { model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'max' },
        impl: { model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'max' },
        reviewer: { model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'max' },
        explorer: { model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'max' },
      };

      const agentRoles = {
        quick: 'small',
        standard: 'big',
        spec: 'big',
        project: 'big',
        impl: 'small',
        reviewer: 'review',
        explorer: 'small',
      };

      // Write agent files
      for (const [name, fields] of Object.entries(agents)) {
        const filePath = path.join(agentsDir, `${name}.md`);
        const content = `---\nmode: primary\nmodel: ${fields.model}\nreasoningEffort: ${fields.reasoningEffort}\ndescription: "Test agent"\n---\n\n# ${name} agent\n`;
        fs.writeFileSync(filePath, content, 'utf8');
      }

      // Switch to deepseek-direct profile (uses built-in deepseek provider)
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

      // All 7 role-mapped agents should be updated
      assert.strictEqual(updatedCount, 7, 'all 7 role-mapped agents should be updated');
      assert.strictEqual(results.length, 7);

      // Verify each agent file was updated
      for (const result of results) {
        const agentPath = path.join(agentsDir, `${result.agent}.md`);
        const content = fs.readFileSync(agentPath, 'utf8');
        assert.ok(content.includes(`model: ${result.newModel}`), `${result.agent} model should be ${result.newModel}`);
      }

      // Verify model changed for all agents (from deepseek/ to deepseek/ — same provider, different profile)
      for (const result of results) {
        assert.ok(result.oldModel.startsWith('deepseek/'), `${result.agent} old model should start with deepseek/`);
        assert.ok(result.newModel.startsWith('deepseek/'), `${result.agent} new model should start with deepseek/`);
      }
    });
  });

  await test('profile switching preserves reasoningEffort', async () => {
    withTempDir((root) => {
      const agentsDir = path.join(root, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      const filePath = path.join(agentsDir, 'quick.md');
      const content = `---\nmode: primary\nmodel: deepseek/deepseek-v4-flash\nreasoningEffort: max\ndescription: "Quick lane"\n---\n\n# Quick agent\n`;
      fs.writeFileSync(filePath, content, 'utf8');

      const agentRoles = { quick: 'small' };
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

      // Create an agent with a role
      const quickPath = path.join(agentsDir, 'quick.md');
      fs.writeFileSync(quickPath, `---\nmode: primary\nmodel: deepseek/deepseek-v4-flash\nreasoningEffort: max\ndescription: "Quick"\n---\n\n# Quick\n`, 'utf8');

      // Create an agent WITHOUT a role in agentRoles
      const customPath = path.join(agentsDir, 'custom-agent.md');
      fs.writeFileSync(customPath, `---\nmode: primary\nmodel: deepseek/deepseek-v4-flash\ndescription: "Custom"\n---\n\n# Custom\n`, 'utf8');

      const agentRoles = { quick: 'small' };
      const profile = {
        small: 'deepseek/deepseek-v4-flash',
        reasoningEffort: 'max',
      };

      const result = utils.updateAgentModel(customPath, profile, agentRoles);
      assert.strictEqual(result, null, 'agents without role should not be updated');

      const quickResult = utils.updateAgentModel(quickPath, profile, agentRoles);
      assert.ok(quickResult !== null, 'agents with role should be updated');
      assert.strictEqual(quickResult.newModel, 'deepseek/deepseek-v4-flash');

      // custom-agent should be unchanged
      const customContent = fs.readFileSync(customPath, 'utf8');
      assert.ok(customContent.includes('model: deepseek/deepseek-v4-flash'), 'unlisted agent should keep original model');
    });
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
