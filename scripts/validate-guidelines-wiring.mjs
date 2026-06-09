#!/usr/bin/env node
/**
 * validate-guidelines-wiring.mjs — Validates that all managed harness surfaces
 * contain the inlined instruction contract (Authority, Concise Instruction Contract,
 * Clarification Contract, Planning Contract, Review Rule, Validation Rule).
 *
 * The contract was previously referenced via a pointer to guidelines.md; it is now
 * embedded directly in each harness home file so that sessions always read it.
 *
 * Usage:
 *   node scripts/validate-guidelines-wiring.mjs          # check only
 *   node scripts/validate-guidelines-wiring.mjs --fix    # fix issues in place (not yet supported)
 *   node scripts/validate-guidelines-wiring.mjs --json   # structured JSON output
 *
 * Exit codes:
 *   0 — all harnesses contain the inlined contract
 *   1 — one or more harnesses are missing contract headings
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUIRED_HEADINGS = [
  '## Authority',
  '## Concise Instruction Contract',
  '## Clarification Contract',
  '## Planning Contract',
  '## Review Rule',
  '## Validation Rule',
];

const MANAGED_HARNESSES = [
  'AGENTS.md',
  'engine-assets/copilot-instructions.md',
  'codex-assets/home/AGENTS.md',
  'opencode-assets/home/AGENTS.md',
  'antigravity-assets/home/GEMINI.md',
  'claude-assets/home/CLAUDE.md',
  '.github/copilot-instructions.md',
];

/**
 * Walk up from `fromDir` looking for .git to find repo root.
 * @param {string} fromDir — directory to start searching from (typically __dirname)
 * @returns {string|null} — absolute path to repo root, or null if not found
 */
function findRepoRoot(fromDir) {
  let current = path.resolve(fromDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Check a single harness for inlined contract headings.
 * @param {string} repoRoot — absolute repo root path
 * @param {string} harness — relative harness path (e.g. "AGENTS.md")
 * @returns {{harness: string, status: string, detail: string, missing: string[]}}
 */
function checkHarness(repoRoot, harness) {
  const harnessPath = path.join(repoRoot, harness);
  try {
    const content = fs.readFileSync(harnessPath, 'utf8');
    const missing = REQUIRED_HEADINGS.filter(h => !content.includes(h));

    if (missing.length === 0) {
      return { harness, status: 'pass', detail: 'contains all required contract headings', missing: [] };
    }

    return {
      harness,
      status: 'missing',
      detail: `missing ${missing.length} required heading${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      missing,
    };
  } catch {
    return { harness, status: 'missing', detail: 'harness file not found', missing: REQUIRED_HEADINGS.slice() };
  }
}

function main() {
  const args = process.argv.slice(2);
  const useJson = args.includes('--json');
  const useFix = args.includes('--fix');

  if (useFix) {
    console.error('--fix is not supported for inlined contract validation. Edit the harness files directly.');
    process.exit(1);
  }

  const repoRoot = findRepoRoot(__dirname);
  if (!repoRoot) {
    if (useJson) {
      console.log(JSON.stringify({
        harnesses: [],
        summary: { total: 0, pass: 0, missing: 0 },
        setupChecks: [
          {
            id: 'instruction-governance',
            label: 'Instruction Governance',
            status: 'blocked',
            detail: 'repo root not found walking up from script directory',
          },
        ],
      }, null, 2));
      return;
    }
    console.error('ERROR: Could not find repo root (package.json not found walking up from script directory).');
    process.exit(1);
  }

  const results = MANAGED_HARNESSES.map(h => checkHarness(repoRoot, h));
  const hasMissing = results.some(r => r.status === 'missing');

  if (useJson) {
    console.log(JSON.stringify({
      harnesses: results,
      summary: {
        total: results.length,
        pass: results.filter(r => r.status === 'pass').length,
        missing: results.filter(r => r.status === 'missing').length,
      },
      setupChecks: [
        {
          id: 'instruction-governance',
          label: 'Instruction Governance',
          status: hasMissing ? 'warning' : 'ok',
          detail: hasMissing
            ? `${results.filter(r => r.status !== 'pass').length} harnesses missing contract headings`
            : 'All harnesses contain inlined instruction contract',
        },
      ],
    }, null, 2));
    return;
  }

  for (const r of results) {
    console.log(`${r.harness}: ${r.status} — ${r.detail}`);
  }

  if (hasMissing) {
    process.exit(1);
  }
}

main();
