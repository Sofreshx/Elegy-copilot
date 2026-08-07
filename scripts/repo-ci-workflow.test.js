'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

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
  assert.match(
    qualityJob,
    /timeout-minutes: 30/,
    'quality job must allow the bounded cold-Windows test budgets to complete.',
  );
  assert.match(qualityJob, /node scripts\/generate-cli-manifest\.mjs/);
  assert.match(qualityJob, /npm --prefix copilot-ui run ui:build/);
  assert.match(qualityJob, /npm --prefix local-tracker run build/);
  assert.match(qualityJob, /cargo build --manifest-path elegy-checks\/Cargo\.toml/);
  assert.match(rootPackage.scripts['quality:test'], /test-with-ledger\.js --force/);
});

test('the maintained local CI contract builds the optional local repo MCP before sidecar validation', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const localCi = rootPackage.scripts['ci:local'];

  assert.match(localCi, /build-local-repo-mcp-if-present\.js/);
  assert.ok(
    localCi.indexOf('build-local-repo-mcp-if-present.js') < localCi.indexOf('validate:tauri-node-sidecar-layout'),
    'local-repo-mcp must be built before the sidecar layout validator runs',
  );
});

test('main preview publishing never force-moves an existing semantic version tag', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'desktop-preview-release.yml'), 'utf8');

  assert.doesNotMatch(workflow, /force=true/);
  assert.match(workflow, /Bump copilot-ui\/package\.json before publishing/);
});

test('desktop release metadata uses one version across npm and Tauri', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'copilot-ui', 'package.json'), 'utf8'));
  const tauriConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'copilot-ui', 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const cargoToml = fs.readFileSync(path.join(repoRoot, 'copilot-ui', 'src-tauri', 'Cargo.toml'), 'utf8');
  const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];

  assert.equal(tauriConfig.version, packageJson.version);
  assert.equal(cargoVersion, packageJson.version);
});
