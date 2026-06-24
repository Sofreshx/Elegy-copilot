/**
 * claim-verifier.js — Deterministic claim verification against filesystem and manifests.
 *
 * Takes extracted claims and verifies them against the actual repo state.
 * Returns DriftIssue objects for failed verifications only.
 *
 * Exports:
 *   verifyClaims(claims, repoRoot)           — Main entry point
 *   verifyPathClaim(claim, repoRoot)         — Check file path existence
 *   verifyCommandClaim(claim, repoRoot)      — Check CLI command validity
 *   verifyDependencyClaim(claim, repoRoot)   — Check dependency existence
 *   verifyLinkClaim(claim, repoRoot, sourceFile) — Check internal link target
 *   verifyRouteEdgeClaim(claim, repoRoot)    — Check frontmatter route edge
 */

'use strict';

var fs = require('fs');
var path = require('path');
var matchFrontmatter = require('./spec-headings').matchFrontmatter;
var parseFrontmatterYaml = require('./spec-yaml').parseFrontmatterYaml;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Commands assumed to exist globally (not verified against manifests). */
var GLOBAL_COMMANDS = new Set([
  'git', 'make', 'docker', 'kubectl', 'elegy',
]);

/** npm built-in subcommands that don't need script-name lookup. */
var NPM_BUILTINS = new Set([
  'init', 'install', 'uninstall', 'update', 'ci', 'dedupe',
  'cache', 'config', 'help', 'version', 'publish', 'pack',
  'start', 'stop', 'restart', 'test', 'exec', 'explore',
  'link', 'outdated', 'rebuild', 'run', 'run-script',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip a version suffix (e.g., `@^18`, `@18.0.0`, `@latest`) from a
 * dependency name. Handles scoped packages (@scope/name@version).
 *
 * @param {string} name — raw dependency value (may include @version)
 * @returns {string} — bare package name without version
 */
function stripVersion(name) {
  if (name.startsWith('@')) {
    // Scoped package: find the second @ which starts the version
    var atIdx = name.indexOf('@', 1);
    if (atIdx !== -1) {
      return name.slice(0, atIdx);
    }
    return name;
  }
  var atIdx = name.indexOf('@');
  if (atIdx !== -1) {
    return name.slice(0, atIdx);
  }
  return name;
}

/**
 * Walk a directory recursively and return all files matching a predicate.
 *
 * @param {string} dirPath — absolute path to start walking from
 * @param {function} [filter] — (filePath) => boolean; optional predicate
 * @returns {string[]} sorted array of absolute file paths
 */
function walkFiles(dirPath, filter) {
  var results = [];
  var entries;

  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return results;
  }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results = results.concat(walkFiles(fullPath, filter));
    } else if (entry.isFile()) {
      if (!filter || filter(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  return results.sort(function (a, b) { return a.localeCompare(b); });
}

/**
 * Try to read and parse a file, returning its parsed content on success
 * or null on failure.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function tryReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DriftIssue factory
// ---------------------------------------------------------------------------

/**
 * Create a DriftIssue object from a claim and problem details.
 *
 * @param {object} claim — the claim object that failed verification
 * @param {string} code — machine-readable issue code
 * @param {string} severity — 'error' or 'warning'
 * @param {string} message — human-readable problem description
 * @param {string} [suggestion] — optional remediation hint
 * @returns {object} DriftIssue
 */
function makeIssue(claim, code, severity, message, suggestion) {
  return {
    code: code,
    severity: severity,
    claim: claim || null,
    file: (claim && claim.source) ? claim.source.file : null,
    line: (claim && claim.source) ? claim.source.line : null,
    message: message,
    suggestion: suggestion || null,
  };
}

// ---------------------------------------------------------------------------
// verifyPathClaim
// ---------------------------------------------------------------------------

/**
 * Check if a referenced file path exists on the filesystem.
 * Resolves the path relative to repoRoot. Directories are valid (existsSync
 * returns true for dirs).
 *
 * @param {object} claim — claim object with `value` being the file path
 * @param {string} repoRoot — absolute path to repo root
 * @returns {object|null} DriftIssue or null if verified
 */
function verifyPathClaim(claim, repoRoot) {
  var resolvedPath = path.resolve(repoRoot, claim.value);

  if (fs.existsSync(resolvedPath)) {
    return null;
  }

  return makeIssue(
    claim,
    'missing_path',
    'error',
    'Referenced path `' + claim.value + '` does not exist',
    'Check if the file was moved or renamed'
  );
}

// ---------------------------------------------------------------------------
// verifyCommandClaim
// ---------------------------------------------------------------------------

/**
 * Check if a referenced CLI command is valid.
 *
 * Verification rules by prefix:
 *   - `npm run <script>` — checks package.json scripts
 *   - `yarn <script>` — checks package.json scripts
 *   - `npx <cmd>` — checks node_modules/.bin/ and dependencies
 *   - `cargo <subcommand>` — checks Cargo.toml presence
 *   - `git`, `make`, `docker`, `kubectl`, `elegy` — assumed global (no check)
 *   - Other npm subcommands — assumed built-in (no check)
 *
 * @param {object} claim — claim object with `value` being the full command
 * @param {string} repoRoot — absolute path to repo root
 * @returns {object|null} DriftIssue or null if verified
 */
function verifyCommandClaim(claim, repoRoot) {
  var value = claim.value;
  var parts = value.split(/\s+/);
  var base = parts[0];

  // Global commands — assume they exist
  if (GLOBAL_COMMANDS.has(base)) {
    return null;
  }

  // npm built-in subcommands (install, test, exec, etc.) — assume valid
  if (base === 'npm' && parts[1] && NPM_BUILTINS.has(parts[1])) {
    // 'npm run' is handled below with script lookup
    if (parts[1] === 'run') {
      // falls through to script verification
    } else {
      return null;
    }
  }

  // Read package.json for commands that need it
  var pkg = tryReadJson(path.join(repoRoot, 'package.json'));

  // npm run <script>
  if (base === 'npm' && parts[1] === 'run') {
    if (!pkg) {
      return makeIssue(
        claim,
        'manifest_parse_error',
        'warning',
        'package.json not found or unparseable',
        'Ensure the repo root has a valid package.json file'
      );
    }

    // Extract the script name (skip -- flags and extra args)
    var script = null;
    for (var j = 2; j < parts.length; j++) {
      if (!parts[j].startsWith('--')) {
        script = parts[j];
        break;
      }
    }
    if (!script) {
      script = parts[2] || '';
    }

    if (pkg.scripts && typeof pkg.scripts === 'object' && pkg.scripts[script]) {
      return null;
    }

    return makeIssue(
      claim,
      'stale_command',
      'warning',
      'Command `' + value + '` not found in package.json scripts',
      'Check if the script name was changed or removed from package.json'
    );
  }

  // yarn <script>
  if (base === 'yarn') {
    if (!pkg) {
      return makeIssue(
        claim,
        'manifest_parse_error',
        'warning',
        'package.json not found or unparseable',
        'Ensure the repo root has a valid package.json file'
      );
    }

    var yarnScript = parts[1];
    if (pkg.scripts && typeof pkg.scripts === 'object' && pkg.scripts[yarnScript]) {
      return null;
    }

    return makeIssue(
      claim,
      'stale_command',
      'warning',
      'Command `' + value + '` not found in package.json scripts',
      'Check if the script name was changed or removed from package.json'
    );
  }

  // npx <cmd>
  if (base === 'npx') {
    var cmd = parts[1] || '';
    if (!cmd) {
      return null; // bare `npx` with no subcommand — nothing to verify
    }

    // Check node_modules/.bin/<cmd>
    var binPath = path.join(repoRoot, 'node_modules', '.bin', cmd);
    if (fs.existsSync(binPath)) {
      return null;
    }

    // Check if cmd exists as a dependency in package.json
    if (pkg) {
      var depCategories = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
      for (var k = 0; k < depCategories.length; k++) {
        var cat = pkg[depCategories[k]];
        if (cat && typeof cat === 'object' && cat[cmd]) {
          return null;
        }
      }
    }

    return makeIssue(
      claim,
      'stale_command',
      'warning',
      'Command `' + value + '` — `' + cmd + '` not found in node_modules/.bin/ or dependencies',
      'Check if the package was removed, renamed, or needs to be installed'
    );
  }

  // cargo <subcommand>
  if (base === 'cargo') {
    var cargoPath = path.join(repoRoot, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      return null;
    }
    return makeIssue(
      claim,
      'stale_command',
      'warning',
      'Command `' + value + '` references cargo but Cargo.toml not found',
      'Check if the project uses Rust or if the cargo reference is stale'
    );
  }

  // Unknown command prefix — can't verify, assume valid
  return null;
}

// ---------------------------------------------------------------------------
// verifyDependencyClaim
// ---------------------------------------------------------------------------

/**
 * Check if a referenced dependency exists in package.json.
 * Checks dependencies, devDependencies, peerDependencies, optionalDependencies,
 * and workspaces entries.
 *
 * @param {object} claim — claim object with `value` being the dependency name
 * @param {string} repoRoot — absolute path to repo root
 * @returns {object|null} DriftIssue or null if verified
 */
function verifyDependencyClaim(claim, repoRoot) {
  // Read package.json
  var pkg = tryReadJson(path.join(repoRoot, 'package.json'));

  if (!pkg) {
    return makeIssue(
      claim,
      'manifest_parse_error',
      'warning',
      'package.json not found or unparseable',
      'Ensure the repo root has a valid package.json file'
    );
  }

  // Strip version suffix (e.g., react@^18 → react)
  var depName = stripVersion(claim.value);

  // Check all dependency categories
  var depCategories = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  for (var i = 0; i < depCategories.length; i++) {
    var cat = pkg[depCategories[i]];
    if (cat && typeof cat === 'object' && cat[depName]) {
      return null;
    }
  }

  // Check workspaces entries (for monorepo dependencies)
  if (pkg.workspaces && Array.isArray(pkg.workspaces)) {
    for (var j = 0; j < pkg.workspaces.length; j++) {
      var ws = pkg.workspaces[j];
      if (typeof ws === 'string' && ws === depName) {
        return null;
      }
      // Workspaces often use globs like "packages/*" — check if depName
      // matches as a simple glob pattern
      if (typeof ws === 'string' && ws.indexOf('*') !== -1) {
        var prefix = ws.split('*')[0];
        if (depName.indexOf(prefix) === 0) {
          return null;
        }
      }
    }
  }

  return makeIssue(
    claim,
    'missing_dependency',
    'warning',
    'Dependency `' + claim.value + '` not found in package.json',
    'Check if the dependency was removed or renamed'
  );
}

// ---------------------------------------------------------------------------
// verifyLinkClaim
// ---------------------------------------------------------------------------

/**
 * Check if an internal markdown link target exists on the filesystem.
 *
 * Rules:
 *   - Anchor-only links (#section-name) are skipped
 *   - External URLs (http/https) are skipped
 *   - The link target is resolved relative to the source file's directory
 *
 * @param {object} claim — claim object with `value` being the link target
 * @param {string} repoRoot — absolute path to repo root
 * @param {string} sourceFile — relative path from repoRoot to the source file
 * @returns {object|null} DriftIssue or null if verified
 */
function verifyLinkClaim(claim, repoRoot, sourceFile) {
  var target = claim.value;

  // Skip anchor-only links (#section-name)
  if (target.startsWith('#')) {
    return null;
  }

  // Skip external links (guard against non-internal links)
  if (/^https?:\/\//i.test(target)) {
    return null;
  }

  // Resolve the link target relative to the source file's directory
  var sourceDir = path.dirname(path.join(repoRoot, sourceFile));
  var resolvedPath = path.resolve(sourceDir, target);

  if (fs.existsSync(resolvedPath)) {
    return null;
  }

  return makeIssue(
    claim,
    'broken_internal_link',
    'error',
    'Linked file `' + target + '` does not exist',
    'Check if the target file was moved or renamed'
  );
}

// ---------------------------------------------------------------------------
// verifyRouteEdgeClaim
// ---------------------------------------------------------------------------

/**
 * Check if a frontmatter `related:` edge points to an existing doc.
 * Walks docs/ recursively, parses frontmatter `id` fields to find a match.
 *
 * @param {object} claim — claim object with `value` being the route edge ID
 * @param {string} repoRoot — absolute path to repo root
 * @returns {object|null} DriftIssue or null if verified
 */
function verifyRouteEdgeClaim(claim, repoRoot) {
  var docsDir = path.join(repoRoot, 'docs');
  if (!fs.existsSync(docsDir)) {
    return makeIssue(
      claim,
      'broken_route_edge',
      'warning',
      'Routed doc with id `' + claim.value + '` not found in docs/',
      'Check if the docs/ directory exists or if the route edge ID is stale'
    );
  }

  // Collect all markdown files in docs/
  var mdFiles = walkFiles(docsDir, function (filePath) {
    return filePath.endsWith('.md');
  });

  // Check each file's frontmatter for a matching id
  for (var i = 0; i < mdFiles.length; i++) {
    var content;
    try {
      content = fs.readFileSync(mdFiles[i], 'utf8');
    } catch (_) {
      continue;
    }

    var fm = matchFrontmatter(content);
    if (!fm) {
      continue;
    }

    try {
      var parsed = parseFrontmatterYaml(fm.yaml);
      if (parsed && parsed.id === claim.value) {
        return null;
      }
    } catch (_) {
      // Skip files with unparseable frontmatter
    }
  }

  return makeIssue(
    claim,
    'broken_route_edge',
    'warning',
    'Routed doc with id `' + claim.value + '` not found in docs/',
    'Check if the target doc was moved, renamed, or had its id field changed'
  );
}

// ---------------------------------------------------------------------------
// verifyClaims (main entry point)
// ---------------------------------------------------------------------------

/**
 * Verify an array of claims against the actual repo state.
 * Dispatches each claim to the appropriate verifier by claim.type.
 * Only returns DriftIssue objects for failed verifications — successful
 * claims are silent.
 *
 * @param {Array<{type: string, value: string, source: {file: string, line: number}}>} claims
 * @param {string} repoRoot — absolute path to repo root
 * @returns {Array<{code: string, severity: string, claim: object|null, file: string|null, line: number|null, message: string, suggestion: string|null}>}
 */
function verifyClaims(claims, repoRoot) {
  if (!Array.isArray(claims)) {
    return [];
  }

  var issues = [];

  for (var i = 0; i < claims.length; i++) {
    var claim = claims[i];

    // Skip malformed claims
    if (!claim || typeof claim !== 'object' || !claim.type || typeof claim.type !== 'string') {
      continue;
    }

    var issue = null;

    switch (claim.type) {
      case 'path':
        issue = verifyPathClaim(claim, repoRoot);
        break;
      case 'command':
        issue = verifyCommandClaim(claim, repoRoot);
        break;
      case 'dependency':
        issue = verifyDependencyClaim(claim, repoRoot);
        break;
      case 'internal_link':
        issue = verifyLinkClaim(
          claim,
          repoRoot,
          claim.source && claim.source.file ? claim.source.file : ''
        );
        break;
      case 'route_edge':
        issue = verifyRouteEdgeClaim(claim, repoRoot);
        break;
      default:
        // Unknown claim type — skip without issue
        break;
    }

    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  verifyClaims: verifyClaims,
  verifyPathClaim: verifyPathClaim,
  verifyCommandClaim: verifyCommandClaim,
  verifyDependencyClaim: verifyDependencyClaim,
  verifyLinkClaim: verifyLinkClaim,
  verifyRouteEdgeClaim: verifyRouteEdgeClaim,
};
