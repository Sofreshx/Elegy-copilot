#!/usr/bin/env node
/**
 * validate-guidelines-wiring.mjs — Validates that all managed harness surfaces
 * reference guidelines.md with the recommended pointer format.
 *
 * See spec.md at specs/concise-instruction-governance/spec.md for full requirements.
 *
 * Usage:
 *   node scripts/validate-guidelines-wiring.mjs          # check only
 *   node scripts/validate-guidelines-wiring.mjs --fix    # fix issues in place
 *   node scripts/validate-guidelines-wiring.mjs --json   # structured JSON output
 *   node scripts/validate-guidelines-wiring.mjs --fix --json  # fix + JSON output
 *
 * Exit codes:
 *   0 — all harnesses reference guidelines.md (pass or stale is OK for exit 0)
 *   1 — one or more harnesses are missing the reference entirely
 *   1 — guidelines.md not found at repo root
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RECOMMENDED_POINTER = 'Follow `guidelines.md`: clarify ambiguity before implementation; write concise, precise, diagram-forward instructions; avoid vague or ceremonial prose.';

const MANAGED_HARNESSES = [
  'AGENTS.md',
  'engine-assets/copilot-instructions.md',
  'codex-assets/home/AGENTS.md',
  'opencode-assets/home/AGENTS.md',
  'antigravity-assets/home/GEMINI.md',
  '.github/copilot-instructions.md',
];

/**
 * Walk up from `fromDir` looking for guidelines.md to find repo root.
 * @param {string} fromDir — directory to start searching from (typically __dirname)
 * @returns {string|null} — absolute path to repo root, or null if not found
 */
function findRepoRoot(fromDir) {
  let current = path.resolve(fromDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'guidelines.md'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null; // reached filesystem root without finding guidelines.md
    }
    current = parent;
  }
}

/**
 * Find all lines in content that reference "guidelines.md" (case-insensitive).
 * @param {string} content — file content
 * @returns {Array<{index: number, text: string}>}
 */
function findGuidelinesRefLines(content) {
  const lines = content.split('\n');
  const refLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('guidelines.md')) {
      refLines.push({ index: i, text: lines[i].replace(/\r$/, '') });
    }
  }
  return refLines;
}

/**
 * Check a single harness for guidelines.md reference status.
 * @param {string} repoRoot — absolute repo root path
 * @param {string} harness — relative harness path (e.g. "AGENTS.md")
 * @returns {{harness: string, status: string, detail: string}}
 */
function checkHarness(repoRoot, harness) {
  const harnessPath = path.join(repoRoot, harness);
  try {
    const content = fs.readFileSync(harnessPath, 'utf8');
    const refLines = findGuidelinesRefLines(content);

    if (refLines.length === 0) {
      return { harness, status: 'missing', detail: 'does not reference guidelines.md' };
    }

    const hasExactPointer = refLines.some(r => r.text.trim() === RECOMMENDED_POINTER);

    if (hasExactPointer && refLines.length === 1) {
      return { harness, status: 'pass', detail: 'references guidelines.md with recommended pointer format' };
    }

    if (hasExactPointer && refLines.length > 1) {
      return {
        harness,
        status: 'stale',
        detail: `references guidelines.md in ${refLines.length} lines; needs deduplication`,
      };
    }

    // Has reference lines but none match the recommended pointer
    if (refLines.length > 1) {
      return {
        harness,
        status: 'stale',
        detail: `references guidelines.md in ${refLines.length} lines, none in recommended format`,
      };
    }

    return {
      harness,
      status: 'stale',
      detail: 'references guidelines.md but not in recommended format',
    };
  } catch {
    return { harness, status: 'missing', detail: 'harness file not found' };
  }
}

/**
 * Apply --fix to a harness: write recommended pointer, replace stale references,
 * and deduplicate multi-references.
 * @param {string} repoRoot — absolute repo root path
 * @param {string} harness — relative harness path
 * @returns {string} — description of what was done
 */
function applyFix(repoRoot, harness) {
  const harnessPath = path.join(repoRoot, harness);
  let content;
  let fileExisted = true;

  try {
    content = fs.readFileSync(harnessPath, 'utf8');
  } catch {
    fileExisted = false;
    content = '';
  }

  const refLines = findGuidelinesRefLines(content);

  if (refLines.length === 0) {
    // Missing — add recommended pointer
    if (fileExisted) {
      fs.writeFileSync(harnessPath, content.trimEnd() + '\n' + RECOMMENDED_POINTER + '\n', 'utf8');
    } else {
      const dir = path.dirname(harnessPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(harnessPath, RECOMMENDED_POINTER + '\n', 'utf8');
    }
    return 'fixed (missing)';
  }

  if (refLines.length === 1 && refLines[0].text.trim() === RECOMMENDED_POINTER) {
    // Pass — nothing to do
    return 'pass (no change)';
  }

  // Stale or multi-reference — replace first occurrence, remove subsequent ones
  const updatedLines = content.split('\n');
  updatedLines[refLines[0].index] = RECOMMENDED_POINTER;
  // Remove subsequent reference lines (iterate in reverse to preserve splice indices)
  for (let i = refLines.length - 1; i >= 1; i--) {
    updatedLines.splice(refLines[i].index, 1);
  }
  // Preserve original line ending style (join back with \n; any \r\n was split on \n)
  fs.writeFileSync(harnessPath, updatedLines.join('\n'), 'utf8');

  if (refLines.length > 1) {
    return `fixed (stale, removed ${refLines.length - 1} duplicate reference${refLines.length > 2 ? 's' : ''})`;
  }
  return 'fixed (stale)';
}

function main() {
  const args = process.argv.slice(2);
  const useFix = args.includes('--fix');
  const useJson = args.includes('--json');

  // Locate repo root by walking up from __dirname
  const repoRoot = findRepoRoot(__dirname);
  if (!repoRoot) {
    if (useJson) {
      console.log(JSON.stringify({
        guidelines: { exists: false },
        harnesses: [],
        summary: { total: 0, pass: 0, stale: 0, missing: 0 },
        setupChecks: [
          {
            id: 'instruction-governance',
            label: 'Instruction Governance',
            status: 'blocked',
            detail: 'guidelines.md not found walking up from script directory',
          },
        ],
      }, null, 2));
      return;
    }
    console.error('ERROR: Could not find repo root (guidelines.md not found walking up from script directory).');
    process.exit(1);
  }

  // Check guidelines.md exists at repo root
  const guidelinesExists = fs.existsSync(path.join(repoRoot, 'guidelines.md'));

  // Check each harness
  const results = MANAGED_HARNESSES.map(h => checkHarness(repoRoot, h));

  // Apply fixes if --fix
  if (useFix) {
    for (const r of results) {
      if (r.status === 'pass') continue;
      const fixResult = applyFix(repoRoot, r.harness);
      const oldDetail = r.detail;
      // Re-check after fix to get accurate status
      const updated = checkHarness(repoRoot, r.harness);
      r.status = updated.status;
      r.detail = `${oldDetail}; fix: ${fixResult}; re-check: ${updated.detail}`;
    }
  }

  const hasMissing = results.some(r => r.status === 'missing');

  if (useJson) {
    console.log(JSON.stringify({
      guidelines: { exists: guidelinesExists },
      harnesses: results,
      summary: {
        total: results.length,
        pass: results.filter(r => r.status === 'pass').length,
        stale: results.filter(r => r.status === 'stale').length,
        missing: results.filter(r => r.status === 'missing').length,
      },
      setupChecks: [
        {
          id: 'instruction-governance',
          label: 'Instruction Governance',
          status: guidelinesExists
            ? (hasMissing ? 'warning' : 'ok')
            : 'blocked',
          detail: guidelinesExists
            ? (hasMissing
                ? `${results.filter(r => r.status !== 'pass').length} harnesses need attention`
                : 'All harnesses properly reference guidelines.md')
            : 'guidelines.md not found at repo root',
        },
      ],
    }, null, 2));
    return;
  }

  // Print human-readable results
  for (const r of results) {
    console.log(`${r.harness}: ${r.status} \u2014 ${r.detail}`);
  }

  if (!guidelinesExists) {
    console.error('ERROR: guidelines.md not found at repo root.');
    process.exit(1);
  }

  if (hasMissing) {
    process.exit(1);
  }
}

main();
