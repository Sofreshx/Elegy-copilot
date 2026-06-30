#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.join(__dirname, 'find-sweeper-candidates.mjs');

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function runFinder(repoRoot) {
  const output = execFileSync(process.execPath, [scriptPath, '--repo-root', repoRoot], {
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

test('reports dependency with no non-metadata references', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-unused-dep-'));
  try {
    writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: {
        leftpad: '1.0.0',
        zod: '1.0.0',
      },
    }, null, 2));
    writeFile(path.join(repoRoot, 'src', 'index.js'), "import { z } from 'zod';\n");

    const result = runFinder(repoRoot);
    assert.ok(result.candidates.some((candidate) => candidate.id === 'unused-dependency:leftpad'));
    assert.ok(!result.candidates.some((candidate) => candidate.id === 'unused-dependency:zod'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('reports managed harness asset not routed through shipped assets', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-unrouted-'));
  try {
    writeFile(path.join(repoRoot, 'catalog-assets', 'shippedAssets.mjs'), "agent('codex-reviewer-agent', 'codex-assets/agents/reviewer.toml');\n");
    writeFile(path.join(repoRoot, 'codex-assets', 'agents', 'reviewer.toml'), 'name = "reviewer"\n');
    writeFile(path.join(repoRoot, 'codex-assets', 'agents', 'orphan.toml'), 'name = "orphan"\n');

    const result = runFinder(repoRoot);
    assert.ok(result.candidates.some((candidate) => candidate.id === 'unrouted-managed-asset:codex-assets/agents/orphan.toml'));
    assert.ok(!result.candidates.some((candidate) => candidate.id === 'unrouted-managed-asset:codex-assets/agents/reviewer.toml'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('defaults repo root to current working directory', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-cwd-'));
  try {
    writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: {
        unused: '1.0.0',
      },
    }, null, 2));

    const output = execFileSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const result = JSON.parse(output);
    assert.equal(result.repoRoot, repoRoot);
    assert.ok(result.candidates.some((candidate) => candidate.id === 'unused-dependency:unused'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
