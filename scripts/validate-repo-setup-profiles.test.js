#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS: ${name}`);
    })
    .catch((error) => {
      console.error(`  FAIL: ${name}`);
      console.error(`    ${error.message}`);
      process.exitCode = 1;
    });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const generator = await import(pathToFileURL(path.resolve(__dirname, 'generate-repo-setup-profiles.mjs')).href);
  const validator = require('./validate-repo-setup-profiles.js');

  await test('generated projection includes spec-driven overlay profile', async () => {
    const projection = generator.generateSetupProfiles({ repoRoot, write: false });
    const profile = projection.profiles.find((entry) => entry && entry.key === 'spec-driven');

    assert.ok(profile, 'expected spec-driven profile to exist');
    assert.strictEqual(profile.profileType, 'overlay');
    assert.deepStrictEqual(
      profile.match.extendsProfileKeys,
      ['docs-root-index', 'documentation-root-index', 'system-docs-index'],
    );
    assert.deepStrictEqual(
      profile.proposals.requiredResourcePaths,
      ['.github/copilot-instructions.md', '.github/skills', 'specs/index.md'],
    );
    assert.deepStrictEqual(
      profile.proposals.recommendedResourcePaths,
      ['AGENTS.md', 'GEMINI.md', 'package.json#scripts.validate:specs', 'scripts/validate-specs.js'],
    );
  });

  await test('repo setup profile validator accepts current repo documents', async () => {
    const result = await validator.validateRepoSetupProfiles({ repoRoot });
    assert.deepStrictEqual(result.errors, []);
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
