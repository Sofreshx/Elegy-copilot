/**
 * spec-collector.js — Collect spec.md files from a target path.
 *
 * Exports:
 *   collectSpecFiles(targetPath) — Recursively find all spec.md files
 */

// Spec-System Hardening (R6): Shared spec file collector. Extracted from validate-specs.js.
// Walks a directory tree to find spec.md files. Used by all spec validators.

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Collect all spec.md files under the given path.
 * If targetPath is a single file, returns that file.
 * If targetPath is a directory, recursively walks for spec.md files.
 *
 * @param {string} targetPath — file or directory path
 * @returns {string[]} sorted array of absolute file paths
 */
function collectSpecFiles(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  if (!fs.existsSync(resolvedTarget)) {
    return [];
  }

  const stat = fs.statSync(resolvedTarget);
  if (stat.isFile()) {
    return [resolvedTarget];
  }

  const files = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'spec.md') {
        files.push(fullPath);
      }
    }
  }

  walk(resolvedTarget);
  return files.sort((left, right) => left.localeCompare(right));
}

module.exports = {
  collectSpecFiles,
};
