#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildProfileContent, composeInstructions } from './instruction-compose-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findRepoRoot(fromDir) {
  let current = path.resolve(fromDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readUtf8(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function byteCount(text) {
  return Buffer.byteLength(text, 'utf8');
}

function lineCount(text) {
  return String(text).split(/\r?\n/).length;
}

function measure(text) {
  return {
    bytes: byteCount(text),
    lines: lineCount(text),
  };
}

function compareToBudget(id, metrics, budget, failures) {
  if (!budget) return;
  if (metrics.bytes > budget.maxBytes) {
    failures.push(`${id}: ${metrics.bytes} bytes exceeds ${budget.maxBytes}`);
  }
  if (metrics.lines > budget.maxLines) {
    failures.push(`${id}: ${metrics.lines} lines exceeds ${budget.maxLines}`);
  }
}

function main() {
  const repoRoot = findRepoRoot(__dirname);
  if (!repoRoot) {
    console.error('ERROR: Could not find repo root.');
    process.exit(1);
  }

  const budgets = JSON.parse(readUtf8(path.join(repoRoot, 'catalog-assets', 'instructions', 'budgets.json')));
  const failures = [];

  const baselinePath = path.join(repoRoot, 'catalog-assets', 'instructions', 'agent-session-defaults.md');
  const presetPath = path.join(repoRoot, 'catalog-assets', 'presets', 'constructive-coworker.md');
  const baselineText = readUtf8(baselinePath);
  const presetText = readUtf8(presetPath);

  compareToBudget('baseline', measure(baselineText), budgets.layers?.baseline, failures);
  compareToBudget('preset.constructive-coworker', measure(presetText), budgets.layers?.preset, failures);

  const targets = [
    { id: 'copilot', appendix: 'engine-assets/copilot-instructions-appendix.md' },
    { id: 'codex', appendix: 'codex-assets/home/AGENTS-appendix.md' },
    { id: 'opencode', appendix: 'opencode-assets/home/AGENTS-appendix.md' },
    { id: 'claude-code', appendix: 'claude-assets/home/CLAUDE-appendix.md' },
    { id: 'antigravity', appendix: 'antigravity-assets/home/GEMINI-appendix.md' },
    { id: 'ghcp', appendix: 'ghcp-assets/home/AGENTS-appendix.md' },
  ];

  const defaultProfile = {
    enabled: true,
    presetId: 'constructive-coworker',
    customInstructions: '',
  };
  const profileContent = buildProfileContent(defaultProfile);

  for (const target of targets) {
    const appendixPath = path.join(repoRoot, target.appendix);
    const appendixText = readUtf8(appendixPath);
    compareToBudget(`appendix.${target.id}`, measure(appendixText), budgets.layers?.appendix?.[target.id], failures);

    for (const pattern of budgets.bannedAppendixPatterns || []) {
      if (appendixText.includes(pattern)) {
        failures.push(`appendix.${target.id}: banned repo-specific pattern present: ${pattern}`);
      }
    }

    const composed = composeInstructions(baselinePath, appendixPath, profileContent);
    compareToBudget(`composed.${target.id}`, measure(composed), budgets.layers?.composed?.[target.id], failures);
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL: ${failure}`);
    }
    process.exit(1);
  }

  console.log('instruction-budgets: ok');
}

main();
