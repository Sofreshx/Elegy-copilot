#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  gateName,
  runAudit,
} = require('./validate-codex-assets.js');
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}
test('Codex asset audit passes on current repository state', () => {
  const result = runAudit();
  assert.deepStrictEqual(result.findings, [], `${gateName} should pass: ${JSON.stringify(result.findings)}`);
});
test('Codex asset audit rejects Copilot-only primitives', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-audit-'));
  try {
    const skillDir = path.join(tempRoot, 'skills', 'bad-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '# Bad skill',
        'Use vscode/askQuestions before calling run_in_terminal.',
        'Persist review notes in ~/.elegy and ask Rubber Duck for approval.',
      ].join('\n'),
      'utf8',
    );
    const result = runAudit({ rootDir: tempRoot });
    assert.ok(result.findings.length >= 4, JSON.stringify(result.findings));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
