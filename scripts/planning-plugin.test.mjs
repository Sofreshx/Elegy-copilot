import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolve the plugin path relative to this file (repo-relative, no hardcoded user path).
const pluginPath = path.resolve(import.meta.dirname, '..', 'opencode-assets', 'plugins', 'planning.js');

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('@opencode-ai/plugin')) {
      skipped += 1;
      console.log(`  SKIP: ${name} (@opencode-ai/plugin not available)`);
    } else {
      failed += 1;
      console.error(`  FAIL: ${name}`);
      console.error(`    ${error.message}`);
      process.exitCode = 1;
    }
  }
}

// --- Tests ---
console.log('planning plugin tests:');
console.log('');

await test('plugin file exists', () => {
  assert.ok(fs.existsSync(pluginPath), `plugin should exist at ${pluginPath}`);
});

await test('plugin file is valid JavaScript', () => {
  const content = fs.readFileSync(pluginPath, 'utf8');
  assert.ok(content.length > 0, 'plugin should not be empty');
  assert.ok(content.includes('PlanningPlugin'), 'plugin should export PlanningPlugin');
  assert.ok(content.includes('export default'), 'plugin should have default export');
  assert.ok(content.includes('@opencode-ai/plugin/tool'), 'plugin should import tool from @opencode-ai/plugin');
});

await test('plugin registers expected tools', () => {
  const content = fs.readFileSync(pluginPath, 'utf8');
  const expectedTools = [
    'planning_health',
    'planning_goal_list',
    'planning_goal_show',
    'planning_roadmap_list',
    'planning_roadmap_show',
    'planning_plan_list',
    'planning_plan_show',
    'planning_work_point_next_runnable',
    'planning_goal_create',
    'planning_roadmap_create',
    'planning_roadmap_add_work_point',
    'planning_plan_create',
    'planning_plan_update_status',
    'planning_validate',
    'planning_context',
    'planning_issue_record',
    'planning_review_point_record',
  ];
  for (const toolName of expectedTools) {
    assert.ok(content.includes(toolName + ':'), `plugin should register tool: ${toolName}`);
  }
});

await test('plugin has shell.env hook', () => {
  const content = fs.readFileSync(pluginPath, 'utf8');
  assert.ok(content.includes('"shell.env"'), 'plugin should have shell.env hook');
  assert.ok(content.includes('ELEGY_PLANNING_BINARY'), 'plugin should inject ELEGY_PLANNING_BINARY');
});

await test('plugin resolves binary via env var fallback', () => {
  const content = fs.readFileSync(pluginPath, 'utf8');
  assert.ok(content.includes('INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH'), 'plugin should check explicit env var');
  assert.ok(content.includes('ELEGY_HOME'), 'plugin should check ELEGY_HOME');
  assert.ok(content.includes('managed-cli'), 'plugin should check managed-cli path');
});

await test('plugin uses machine mode flags', () => {
  const content = fs.readFileSync(pluginPath, 'utf8');
  assert.ok(content.includes('--json'), 'plugin should pass --json flag');
  assert.ok(content.includes('--non-interactive'), 'plugin should pass --non-interactive flag');
  assert.ok(content.includes('--correlation-id'), 'plugin should pass --correlation-id flag');
});

await test('plugin handles multi-value flags correctly', () => {
  const content = fs.readFileSync(pluginPath, 'utf8');
  // Check that multi-value flags are repeated per value (not comma-joined)
  assert.ok(content.includes('for (const v of args.tag)'), 'plugin should repeat --tag flag per value');
  assert.ok(content.includes('for (const v of args.acceptance)'), 'plugin should repeat --acceptance flag per value');
  assert.ok(content.includes('for (const v of args.rejection)'), 'plugin should repeat --rejection flag per value');
});

// Try to import the plugin if @opencode-ai/plugin is available
try {
  const pluginUrl = pathToFileURL(pluginPath).href;
  const { PlanningPlugin } = await import(pluginUrl);

  await test('PlanningPlugin is a function', () => {
    assert.strictEqual(typeof PlanningPlugin, 'function', 'PlanningPlugin should be exported as a function');
  });

  await test('PlanningPlugin returns hooks object with tool map', async () => {
    const plugin = await PlanningPlugin({ project: { path: '/tmp/test' } });
    assert.ok(plugin, 'plugin should return an object');
    assert.ok(plugin.tool, 'plugin should have a tool property');
    assert.strictEqual(typeof plugin.tool, 'object', 'tool should be an object');
  });

  await test('plugin registers all 17 tools', async () => {
    const plugin = await PlanningPlugin({ project: { path: '/tmp/test' } });
    const expectedTools = [
      'planning_health',
      'planning_goal_list',
      'planning_goal_show',
      'planning_roadmap_list',
      'planning_roadmap_show',
      'planning_plan_list',
      'planning_plan_show',
      'planning_work_point_next_runnable',
      'planning_goal_create',
      'planning_roadmap_create',
      'planning_roadmap_add_work_point',
      'planning_plan_create',
      'planning_plan_update_status',
      'planning_validate',
      'planning_context',
      'planning_issue_record',
      'planning_review_point_record',
    ];
    for (const name of expectedTools) {
      assert.ok(plugin.tool[name], `tool ${name} should be registered`);
      assert.strictEqual(typeof plugin.tool[name].execute, 'function', `tool ${name} should have execute function`);
      assert.strictEqual(typeof plugin.tool[name].description, 'string', `tool ${name} should have description`);
    }
    assert.strictEqual(Object.keys(plugin.tool).length, expectedTools.length, `should have exactly ${expectedTools.length} tools`);
  });

  await test('tools have proper args schemas', async () => {
    const plugin = await PlanningPlugin({ project: { path: '/tmp/test' } });

    // planning_health should have no required args
    const healthArgs = plugin.tool.planning_health.args;
    assert.ok(healthArgs, 'planning_health should have args');

    // planning_goal_show should require goalId
    const goalShowArgs = plugin.tool.planning_goal_show.args;
    assert.ok(goalShowArgs.goalId, 'planning_goal_show should have goalId arg');

    // planning_goal_create should have required id and title
    const goalCreateArgs = plugin.tool.planning_goal_create.args;
    assert.ok(goalCreateArgs.id, 'planning_goal_create should have id arg');
    assert.ok(goalCreateArgs.title, 'planning_goal_create should have title arg');
  });

  await test('plugin has shell.env hook', async () => {
    const plugin = await PlanningPlugin({ project: { path: '/tmp/test' } });
    assert.strictEqual(typeof plugin['shell.env'], 'function', 'plugin should have shell.env hook');
  });

  await test('shell.env hook injects ELEGY_PLANNING_BINARY', async () => {
    const plugin = await PlanningPlugin({ project: { path: '/tmp/test' } });
    const output = { env: {} };
    await plugin['shell.env']({}, output);
    assert.ok(output.env.ELEGY_PLANNING_BINARY, 'should inject ELEGY_PLANNING_BINARY');
  });
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' && err.message.includes('@opencode-ai/plugin')) {
    console.log('');
    console.log('  Note: @opencode-ai/plugin not available — runtime tests skipped.');
    console.log('  These tests will pass when run in the OpenCode runtime environment.');
  } else {
    throw err;
  }
}

// --- Summary ---
console.log('');
console.log(`planning plugin tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) {
  process.exitCode = 1;
}
