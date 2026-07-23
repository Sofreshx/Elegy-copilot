#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function fail(message) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  process.exit(1);
}

function parseRepo(argv) {
  const index = argv.indexOf('--repo');
  if (index < 0 || !argv[index + 1]) fail('--repo <absolute-repo-root> is required');
  const repo = path.resolve(argv[index + 1]);
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) fail(`Repository directory not found: ${repo}`);
  return repo;
}

function exists(repo, relativePath) {
  return fs.existsSync(path.join(repo, relativePath));
}

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function detectManager(repo, hooksPath) {
  if (exists(repo, 'lefthook.yml') || exists(repo, 'lefthook.yaml')) return 'lefthook';
  if (exists(repo, '.husky')) return 'husky';
  if (exists(repo, '.pre-commit-config.yaml')) return 'pre-commit';
  if (exists(repo, '.githooks')) return 'elegy-legacy';
  return 'none';
}

const repo = parseRepo(process.argv.slice(2));
if (!exists(repo, '.git')) fail(`Not a Git repository root: ${repo}`);

const node = exists(repo, 'package.json');
const rust = exists(repo, 'Cargo.toml') || exists(repo, 'copilot-ui/src-tauri/Cargo.toml');
const hooksPath = git(repo, ['config', '--get', 'core.hooksPath']);
const hookManager = detectManager(repo, hooksPath);
const elegyConfig = exists(repo, '.elegy/checks.json');
const legacyConfig = exists(repo, '.copilot/commit-checks.json');
const workflows = exists(repo, '.github/workflows')
  ? fs.readdirSync(path.join(repo, '.github/workflows')).filter((name) => /\.ya?ml$/i.test(name)).sort()
  : [];
const findings = [];

if (!node) findings.push({ severity: 'error', id: 'unsupported-root', message: 'V1 setup supports Node-rooted repositories.' });
if (hookManager === 'none') findings.push({ severity: 'warning', id: 'missing-hook-manager', message: 'No supported hook manager is configured.' });
if (hookManager === 'elegy-legacy') findings.push({ severity: 'warning', id: 'legacy-hook-manager', message: 'Migrate tracked .githooks to a maintained hook manager.' });
if (!elegyConfig) findings.push({ severity: 'warning', id: 'missing-elegy-config', message: '.elegy/checks.json is missing.' });
if (elegyConfig && legacyConfig) findings.push({ severity: 'error', id: 'dual-authority', message: 'Both current and legacy check configs exist.' });
if (workflows.length === 0) findings.push({ severity: 'warning', id: 'missing-ci', message: 'No GitHub Actions workflows were found.' });

const recommendedManager = hookManager === 'none' || hookManager === 'elegy-legacy' ? 'lefthook' : hookManager;
process.stdout.write(`${JSON.stringify({
  ok: findings.every((finding) => finding.id !== 'unsupported-root'),
  schemaVersion: 'repo-quality-audit/v1',
  repo,
  stack: { node, rust, adapter: node && rust ? 'node-rust' : node ? 'node' : rust ? 'rust' : 'unknown' },
  hooks: { detectedManager: hookManager, recommendedManager, coreHooksPath: hooksPath || null },
  checks: { elegyConfig, legacyConfig },
  github: { workflows },
  findings,
  nextStep: 'Inspect native commands and present an exact change preview before mutation.',
}, null, 2)}\n`);
