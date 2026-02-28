#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

const schema = require('../../engine-assets/policy/policy.schema.json');
const policy = require('../../engine-assets/policy/pipeline-policy.json');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

// --- Schema structure tests ---

console.log('policy.schema.json — structure');

test('scope enum includes all expected values', () => {
  const scopeEnum = schema.properties.rules.items.properties.scope.enum;
  for (const v of ['ui', 'api', 'ci', 'release', 'agent']) {
    assert.ok(scopeEnum.includes(v), `scope enum missing "${v}"`);
  }
});

test('match.type enum includes hook-rule', () => {
  const typeEnum = schema.properties.rules.items.properties.match.properties.type.enum;
  assert.ok(typeEnum.includes('hook-rule'), 'match.type enum missing "hook-rule"');
});

test('hookConfig property exists on rule items', () => {
  assert.ok(schema.properties.rules.items.properties.hookConfig, 'hookConfig not defined');
});

test('hookConfig requires toolNamePattern', () => {
  const hc = schema.properties.rules.items.properties.hookConfig;
  assert.ok(hc.required.includes('toolNamePattern'), 'hookConfig.required missing toolNamePattern');
});

test('if/then conditional requires hookConfig for hook-rule', () => {
  const rule = schema.properties.rules.items;
  assert.ok(rule.if, 'if clause missing');
  assert.ok(rule.then, 'then clause missing');
  assert.ok(rule.then.required.includes('hookConfig'), 'then.required missing hookConfig');
  // Verify the if clause checks match.type === hook-rule
  assert.strictEqual(
    rule.if.properties.match.properties.type.const,
    'hook-rule',
    'if clause should match type "hook-rule"'
  );
});

test('scope enum does NOT include arbitrary values', () => {
  const scopeEnum = schema.properties.rules.items.properties.scope.enum;
  assert.ok(!scopeEnum.includes('workflow'), '"workflow" should not be in scope enum');
  assert.ok(!scopeEnum.includes('unknown'), '"unknown" should not be in scope enum');
});

// --- pipeline-policy.json content tests ---

console.log('\npipeline-policy.json — content');

test('has schemaVersion 1.1.0', () => {
  assert.strictEqual(policy.schemaVersion, '1.1.0');
});

test('has at least 6 rules', () => {
  assert.ok(policy.rules.length >= 6, `expected >= 6 rules, got ${policy.rules.length}`);
});

test('original 4 rules are intact', () => {
  const ids = policy.rules.map(r => r.id);
  for (const expected of [
    'ui.block.unsafe-lifecycle-action',
    'api.block.invalid-policy-evidence',
    'ci.block.missing-policy-lock',
    'release.block.attestation-mismatch',
  ]) {
    assert.ok(ids.includes(expected), `missing rule "${expected}"`);
  }
});

test('original rules do NOT have hookConfig', () => {
  const originalIds = [
    'ui.block.unsafe-lifecycle-action',
    'api.block.invalid-policy-evidence',
    'ci.block.missing-policy-lock',
    'release.block.attestation-mismatch',
  ];
  for (const id of originalIds) {
    const rule = policy.rules.find(r => r.id === id);
    assert.ok(rule, `rule "${id}" not found`);
    assert.strictEqual(rule.hookConfig, undefined, `rule "${id}" should not have hookConfig`);
  }
});

test('has hook-rule rules with hookConfig', () => {
  const hookRules = policy.rules.filter(r => r.match.type === 'hook-rule');
  assert.ok(hookRules.length >= 2, `expected >= 2 hook-rules, got ${hookRules.length}`);
  for (const r of hookRules) {
    assert.ok(r.hookConfig, `hook-rule "${r.id}" missing hookConfig`);
    assert.ok(r.hookConfig.toolNamePattern, `hook-rule "${r.id}" missing toolNamePattern`);
  }
});

test('hook-rule rules use agent scope', () => {
  const hookRules = policy.rules.filter(r => r.match.type === 'hook-rule');
  for (const r of hookRules) {
    assert.strictEqual(r.scope, 'agent', `hook-rule "${r.id}" should have scope "agent"`);
  }
});

test('every rule has required fields', () => {
  for (const r of policy.rules) {
    assert.ok(r.id, `rule missing id`);
    assert.ok(r.severity, `rule "${r.id}" missing severity`);
    assert.ok(r.scope, `rule "${r.id}" missing scope`);
    assert.ok(r.match, `rule "${r.id}" missing match`);
    assert.ok(r.match.type, `rule "${r.id}" missing match.type`);
    assert.ok(r.match.pattern, `rule "${r.id}" missing match.pattern`);
    assert.ok(r.outcome, `rule "${r.id}" missing outcome`);
    assert.ok(r.outcome.action, `rule "${r.id}" missing outcome.action`);
  }
});

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
