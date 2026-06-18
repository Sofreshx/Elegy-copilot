#!/usr/bin/env node
/**
 * validate-guidelines-wiring.mjs (DEPRECATED — shim)
 *
 * This script is deprecated. The `guidelines.md` surface has been fully
 * retired in favor of per-harness instruction files (AGENTS.md, CLAUDE.md,
 * GEMINI.md, copilot-instructions.md) and the new shared authoring skills
 * (`skill-authoring`, `agents-md-authoring`).
 *
 * Use `scripts/validate-instruction-wiring.mjs` for the replacement
 * validator. This shim prints a deprecation notice and forwards to the
 * new script. The deprecated shim will be removed in a follow-up.
 *
 * Usage:
 *   node scripts/validate-guidelines-wiring.mjs
 */

'use strict';

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.error('WARN: validate-guidelines-wiring.mjs is deprecated.');
console.error('WARN: Use scripts/validate-instruction-wiring.mjs instead.');
console.error('');

const args = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'validate-instruction-wiring.mjs'), ...args],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
