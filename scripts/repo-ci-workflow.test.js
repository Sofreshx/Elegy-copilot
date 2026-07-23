'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('clean-checkout CI builds every sidecar model before validating the Tauri layout', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'repo-ci.yml'), 'utf8');

  const localRepoBuild = workflow.indexOf('npm --prefix local-repo-mcp run build');
  const sidecarValidation = workflow.indexOf('npm --prefix copilot-ui run validate:tauri-node-sidecar-layout');

  assert.notEqual(localRepoBuild, -1, 'Repo CI must build local-repo-mcp.');
  assert.ok(
    localRepoBuild < sidecarValidation,
    'Repo CI must build local-repo-mcp before validating the Tauri sidecar layout.',
  );
});

test('the Rust quality gate prepares Tauri generated resources on a clean checkout', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.match(
    rootPackage.scripts['quality:rust'],
    /prepare:tauri:resource-dir/,
    'quality:rust must create the generated Tauri resource directory before Cargo runs.',
  );
});

test('desktop quality runs cold on the supported Windows platform with generated artifacts', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'repo-ci.yml'), 'utf8');
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const qualityJob = workflow.split('  quality:')[1].split('  desktop-tauri-preview:')[0];

  assert.match(qualityJob, /runs-on: windows-latest/);
  assert.match(qualityJob, /node scripts\/generate-cli-manifest\.mjs/);
  assert.match(qualityJob, /npm --prefix copilot-ui run ui:build/);
  assert.match(qualityJob, /npm --prefix local-tracker run build/);
  assert.match(qualityJob, /npm --prefix local-repo-mcp run build/);
  assert.match(qualityJob, /cargo build --manifest-path elegy-checks\/Cargo\.toml/);
  assert.match(rootPackage.scripts['quality:test'], /test-with-ledger\.js --force/);
});
