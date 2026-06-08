/**
 * spec-path-heuristics.js — Heuristics for identifying file-path references in spec text.
 *
 * Exports:
 *   KNOWN_SOURCE_DIRS  — Set of known top-level source directories in the repo
 *   looksLikeFilePath(p) — Check if a string looks like a file path reference
 */

// Spec-System Hardening (R6): Shared file path heuristics. Extracted from validate-specs.js.
// Provides looksLikeFilePath() for liveness checks and KNOWN_SOURCE_DIRS for path resolution.
// R11.2: Fixed Windows path regex to catch both C:\ and C:/ variants.

'use strict';

const KNOWN_SOURCE_DIRS = new Set([
  'opencode-assets', 'catalog-assets', 'codex-assets', 'antigravity-assets',
  'engine-assets', 'scripts', 'docs', 'specs', 'contracts', 'copilot-ui',
  'local-tracker', 'elegy-assets',
]);

/**
 * Heuristic check: does the given string look like a file path reference?
 * Excludes URLs, shell variables, home-directory references, Windows absolute paths,
 * function calls, and strings without directory separators or file extensions.
 *
 * @param {string} p
 * @returns {boolean}
 */
function looksLikeFilePath(p) {
  const s = p.trim();
  if (/^https?:\/\//i.test(s)) return false;
  if (/^\$/.test(s)) return false;
  if (/^~/.test(s)) return false;
  if (/^[A-Z]:[\\/]/i.test(s)) return false;
  if (/\s/.test(s)) return false;            // spaces → CLI command, not a file
  if (/^\w+\(/.test(s)) return false;         // function call
  if (!/[/\\]/.test(s)) return false;         // must have a directory separator
  if (!/\.[a-zA-Z]\w*$/.test(s)) {            // no file extension
    const firstSeg = s.split(/[/\\]/)[0];
    return KNOWN_SOURCE_DIRS.has(firstSeg);    // allow bare dir references
  }
  return true;
}

module.exports = {
  KNOWN_SOURCE_DIRS,
  looksLikeFilePath,
};
