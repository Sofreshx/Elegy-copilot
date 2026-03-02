'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const copilotUiRoot = path.resolve(__dirname, '..');
const allowlistPath = path.join(__dirname, 'fixtures', 'sandbox-token-contract-literal-allowlist.json');

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'ui-dist',
  'dist-electron',
  'coverage',
  '.tmp',
]);

const INCLUDED_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);

const TARGET_LITERALS = Object.freeze([
  'missing_token',
  'tracker_token_missing',
  'Tracker token not configured',
]);

const WS05_LITERAL_ALLOWLIST_ADDITIONS = Object.freeze({
  missing_token: [
    'copilot-ui/server.js',
    'copilot-ui/server.lifecycle-proxy.test.js',
  ],
  tracker_token_missing: [
    'copilot-ui/server.js',
    'copilot-ui/server.lifecycle-proxy.test.js',
    'copilot-ui/routes/tracker.test.js',
  ],
  'Tracker token not configured': [
    'copilot-ui/server.js',
    'copilot-ui/routes/tracker.js',
    'copilot-ui/server.lifecycle-proxy.test.js',
    'copilot-ui/routes/tracker.test.js',
  ],
});

function toWorkspaceRelative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasLiteral(text, literal) {
  if (literal.includes(' ')) {
    return text.includes(literal);
  }

  const boundary = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(literal)}([^A-Za-z0-9_]|$)`);
  return boundary.test(text);
}

function collectFiles(rootDir, out = []) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        collectFiles(fullPath, out);
      }
      continue;
    }

    if (INCLUDED_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }

  return out;
}

function normalizeAllowlist(raw) {
  const out = new Map();
  for (const literal of TARGET_LITERALS) {
    const items = Array.isArray(raw[literal]) ? raw[literal] : [];
    const ws05Items = Array.isArray(WS05_LITERAL_ALLOWLIST_ADDITIONS[literal])
      ? WS05_LITERAL_ALLOWLIST_ADDITIONS[literal]
      : [];
    out.set(literal, new Set([...items, ...ws05Items].map((item) => String(item))));
  }
  return out;
}

function validateAllowlistPaths(allowlist) {
  const missing = [];

  for (const literal of TARGET_LITERALS) {
    const files = allowlist.get(literal) || new Set();
    for (const relativePath of files) {
      const absolutePath = path.join(repoRoot, relativePath.replace(/\//g, path.sep));
      if (!fs.existsSync(absolutePath)) {
        missing.push(`${literal} -> ${relativePath}`);
      }
    }
  }

  return missing;
}

function main() {
  const allowlistRaw = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  const allowlist = normalizeAllowlist(allowlistRaw);

  const missingAllowlistPaths = validateAllowlistPaths(allowlist);
  assert.strictEqual(
    missingAllowlistPaths.length,
    0,
    `Allowlist contains missing files:\n${missingAllowlistPaths.join('\n')}`,
  );

  const files = collectFiles(copilotUiRoot);
  const violations = [];

  for (const filePath of files) {
    const relativePath = toWorkspaceRelative(filePath);
    const text = fs.readFileSync(filePath, 'utf8');

    for (const literal of TARGET_LITERALS) {
      if (!hasLiteral(text, literal)) {
        continue;
      }

      const allowedFiles = allowlist.get(literal) || new Set();
      if (!allowedFiles.has(relativePath)) {
        violations.push(`${relativePath} contains disallowed literal: ${literal}`);
      }
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Disallowed sandbox token literals found:\n${violations.join('\n')}`,
  );

  console.log(`PASS: sandbox token literal guard (${files.length} files scanned)`);
}

main();
