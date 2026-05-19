#!/usr/bin/env node
/**
 * Shared CLI utilities for Node scripts under scripts/.
 *
 * Conventions (aligned with scripts/cli-install.sh):
 *   - Deterministic repo-root resolution via import.meta.url (never process.cwd())
 *   - die() for fatal errors: prints to stderr and exits
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Absolute path to the repo root.
 * Resolved relative to this file: scripts/lib/ → scripts/ → repo root.
 */
export const repoRoot = path.resolve(__dirname, '../..');

/**
 * Write msg to stderr and exit with the given code.
 * @param {string} msg
 * @param {number} [code=1]
 */
export function die(msg, code = 1) {
	process.stderr.write(msg + '\n');
	process.exit(code);
}
